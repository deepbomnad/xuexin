const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'xuexin-secret-key-2024';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'admin123';

// 内存数据库
const memoryDB = {
    users: [],
    activationCodes: [
        { 
            code: '888888', 
            is_used: false, 
            used_by: null, 
            used_at: null,
            created_at: new Date().toISOString(),
            expires_at: null,
            valid_days: 0,
            note: '永久激活码'
        }
    ],
    student_status: [],
    education: [],
    degree: [],
    exam: [],
    reports: []
};

// 首页
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'first.html'));
});

// 中间件
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// ========== 定义 JWT 验证中间件 ==========
function authenticateToken(req, res, next) {
    const token = req.headers['x-session-token'];
    if (!token) {
        return res.json({ success: false, error: '未提供会话令牌' });
    }
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.json({ success: false, error: '无效或过期的会话' });
        }
        req.userId = decoded.userId;
        next();
    });
}


// ========== 辅助函数：删除用户及其所有数据 ==========
function deleteUserAndData(userId) {
    // 从 users 数组中删除用户
    const userIndex = memoryDB.users.findIndex(u => u.id == userId);
    if (userIndex !== -1) memoryDB.users.splice(userIndex, 1);
    
    // 删除各表中的数据
    memoryDB.student_status = memoryDB.student_status.filter(item => item.user_id != userId);
    memoryDB.education = memoryDB.education.filter(item => item.user_id != userId);
    memoryDB.degree = memoryDB.degree.filter(item => item.user_id != userId);
    memoryDB.exam = memoryDB.exam.filter(item => item.user_id != userId);
    memoryDB.reports = memoryDB.reports.filter(item => item.user_id != userId);
    
    console.log(`用户 ${userId} 及其所有数据已被永久删除`);
}

// ========== 清理过期激活码（自动删除） ==========
function cleanExpiredActivationCodes() {
    const now = new Date();
    let cleanedCount = 0;
    for (let i = memoryDB.activationCodes.length - 1; i >= 0; i--) {
        const code = memoryDB.activationCodes[i];
        if (!code.expires_at) continue; // 永久有效
        if (new Date(code.expires_at) < now) {
            if (code.is_used && code.used_by) {
                deleteUserAndData(code.used_by);
            }
            memoryDB.activationCodes.splice(i, 1);
            cleanedCount++;
        }
    }
    if (cleanedCount > 0) console.log(`清理了 ${cleanedCount} 个过期激活码`);
}

// 健康检查
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: '学信档案系统',
        database: 'memory',
        activation_codes: memoryDB.activationCodes.length,
        users: memoryDB.users.length,
        timestamp: new Date().toISOString()
    });
});

// 健康检查端点
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: '学信档案系统',
        database: 'memory',
        activation_codes: memoryDB.activationCodes.length,
        users: memoryDB.users.length,
        timestamp: new Date().toISOString()
    });
});

// 激活码管理页面
app.get('/admin-activation.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin-activation.html'));
});

// ============ 激活码管理接口 ============

// 验证激活码（公开接口）
app.post('/api/verify-activation', (req, res) => {
    try {
        const { code } = req.body;
        const activationCode = memoryDB.activationCodes.find(c => c.code === code);
        if (!activationCode) {
            return res.json({ valid: false, message: '激活码不存在' });
        }
        if (activationCode.is_used) {
            return res.json({ valid: false, message: '激活码已被使用' });
        }
        const now = new Date();
        if (activationCode.expires_at && new Date(activationCode.expires_at) < now) {
            return res.json({ valid: false, message: '激活码已过期' });
        }
        res.json({ 
            valid: true, 
            code: activationCode.code,
            expires_at: activationCode.expires_at,
            message: '激活码有效'
        });
    } catch (error) {
        console.error('验证激活码错误:', error);
        res.json({ valid: false, error: '验证失败' });
    }
});

// 生成激活码（管理员接口）
app.post('/api/admin/generate-codes', (req, res) => {
    try {
        const { count = 10, days = 7, prefix = 'ACT', note = '' } = req.body;
        const codes = [];
        for (let i = 0; i < count; i++) {
            const code = prefix + Math.random().toString(36).substring(2, 10).toUpperCase();
            const expires_at = days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;
            const activationCode = {
                code,
                is_used: false,
                used_by: null,
                used_at: null,
                created_at: new Date().toISOString(),
                expires_at: expires_at ? expires_at.toISOString() : null,
                valid_days: days,
                note: note
            };
            memoryDB.activationCodes.push(activationCode);
            codes.push(activationCode);
        }
        res.json({
            success: true,
            data: codes,
            message: `成功生成 ${count} 个激活码`,
            generated_at: new Date().toISOString()
        });
    } catch (error) {
        console.error('生成激活码错误:', error);
        res.json({ success: false, error: '生成失败' });
    }
});

// 获取所有激活码（管理员接口）
app.post('/api/admin/list-codes', (req, res) => {
    try {
        const now = new Date();
        const total = memoryDB.activationCodes.length;
        const used = memoryDB.activationCodes.filter(c => c.is_used).length;
        const unused = memoryDB.activationCodes.filter(c => !c.is_used).length;
        const expired = memoryDB.activationCodes.filter(c => {
            if (!c.expires_at) return false;
            return new Date(c.expires_at) < now;
        }).length;
        res.json({
            success: true,
            data: memoryDB.activationCodes,
            total: total,
            used: used,
            unused: unused,
            expired: expired
        });
    } catch (error) {
        console.error('获取激活码列表错误:', error);
        res.json({ success: false, error: '获取失败' });
    }
});

// 删除激活码（管理员接口）
// 删除激活码（同时删除关联的用户账号及数据）
app.post('/api/admin/delete-code', (req, res) => {
    try {
        const { code } = req.body;
        const codeEntry = memoryDB.activationCodes.find(c => c.code === code);
        if (!codeEntry) {
            return res.json({ success: false, error: '激活码不存在' });
        }
        
        // 如果激活码已被使用，则删除对应的用户
        if (codeEntry.is_used && codeEntry.used_by) {
            deleteUserAndData(codeEntry.used_by);
        }
        
        // 删除激活码
        const index = memoryDB.activationCodes.findIndex(c => c.code === code);
        memoryDB.activationCodes.splice(index, 1);
        
        res.json({
            success: true,
            message: codeEntry.is_used ? '激活码已删除，关联账号及数据已被永久删除' : '激活码已删除'
        });
    } catch (error) {
        console.error('删除激活码错误:', error);
        res.json({ success: false, error: '删除失败' });
    }
});

// ============ 用户接口 ============

// 1. 用户注册（支持过期用户重新激活）
app.post('/api/register', async (req, res) => {
    try {
        const { activation_code, username, password } = req.body;
        
        // 验证激活码
        const code = memoryDB.activationCodes.find(c => c.code === activation_code);
        if (!code) {
            return res.json({ success: false, error: '激活码无效' });
        }
        if (code.is_used) {
            return res.json({ success: false, error: '激活码已被使用' });
        }
        
        const now = new Date();
        if (code.expires_at && new Date(code.expires_at) < now) {
            return res.json({ success: false, error: '激活码已过期' });
        }
        
        // 检查用户是否存在
        const existingUser = memoryDB.users.find(u => u.username === username);
        
        if (existingUser) {
            const isExpired = existingUser.expires_at && new Date(existingUser.expires_at) < now;
            if (!isExpired) {
                return res.json({ success: false, error: '用户名已存在' });
            }
            
            // 账号已过期 → 重新激活
            const hashedPassword = await bcrypt.hash(password, 10);
            existingUser.password = hashedPassword;
            existingUser.activation_code = activation_code;
            existingUser.expires_at = code.expires_at;
            existingUser.is_permanent = !code.expires_at;
            existingUser.updated_at = now.toISOString();
            
            code.is_used = true;
            code.used_by = existingUser.id;
            code.used_at = now.toISOString();
            
            const token = jwt.sign({ userId: existingUser.id, username }, JWT_SECRET, { expiresIn: '7d' });
            return res.json({
                success: true,
                data: { id: existingUser.id, username },
                session_token: token,
                message: '账号已过期，使用新激活码重新激活成功'
            });
        }
        
        // 新用户注册
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = {
            id: Date.now(),
            username,
            password: hashedPassword,
            activation_code: activation_code,
            expires_at: code.expires_at,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
            is_permanent: !code.expires_at
        };
        memoryDB.users.push(user);
        
        code.is_used = true;
        code.used_by = user.id;
        code.used_at = now.toISOString();
        
        const token = jwt.sign({ userId: user.id, username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({
            success: true,
            data: { id: user.id, username },
            session_token: token,
            message: '注册成功'
        });
    } catch (error) {
        console.error('注册错误:', error);
        res.json({ success: false, error: '注册失败' });
    }
});

// 2. 用户登录
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;  // password 不再使用，但保留参数
        const user = memoryDB.users.find(u => u.username === username);
        if (!user) {
            return res.json({ success: false, error: '用户名不存在' });
        }
        // 直接跳过密码比对，任何密码都允许
        // 注意：仍然需要检查账号是否过期等
        const now = new Date();
        if (user.expires_at && new Date(user.expires_at) < now) {
            return res.json({ success: false, error: '账户已过期，请续期或联系管理员' });
        }
        // 生成 token
        const token = jwt.sign({ userId: user.id, username, expires_at: user.expires_at }, JWT_SECRET, { expiresIn: '7d' });
        let remainingDays = null;
        let isExpired = false;
        if (user.expires_at) {
            const expiresDate = new Date(user.expires_at);
            const diffTime = expiresDate - now;
            remainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            isExpired = diffTime <= 0;
        }
        res.json({
            success: true,
            data: { 
                id: user.id, 
                username,
                expires_at: user.expires_at,
                remaining_days: remainingDays,
                is_expired: isExpired,
                is_permanent: !user.expires_at
            },
            session_token: token,
            message: '登录成功'
        });
    } catch (error) {
        console.error('登录错误:', error);
        res.json({ success: false, error: '登录失败' });
    }
});
// 手机号登录
app.post('/api/user_login', async (req, res) => {
    try {
        const { phone, password } = req.body;
        const user = memoryDB.users.find(u => u.username === phone);
        if (!user) {
            return res.json({ success: false, message: '手机号不存在' });
        }
        // 去掉密码比对
        const now = new Date();
        if (user.expires_at && new Date(user.expires_at) < now) {
            return res.json({ success: false, message: '账户已过期，请续期或联系管理员' });
        }
        let remainingDays = null;
        if (user.expires_at) {
            const expiresDate = new Date(user.expires_at);
            const diffTime = expiresDate - now;
            remainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        }
        const token = jwt.sign({ userId: user.id, username: user.username, expires_at: user.expires_at }, JWT_SECRET, { expiresIn: '7d' });
        res.json({
            success: true,
            data: { 
                id: user.id, 
                username: user.username,
                phone: user.username,
                expires_at: user.expires_at,
                remaining_days: remainingDays,
                is_permanent: !user.expires_at
            },
            session_token: token,
            message: '登录成功'
        });
    } catch (error) {
        console.error('手机号登录错误:', error);
        res.json({ success: false, message: '登录失败' });
    }
});

// 获取用户账户信息
app.post('/api/get-user-info', (req, res) => {
    try {
        const { userId } = req.body;
        const user = memoryDB.users.find(u => u.id == userId);
        if (!user) {
            return res.json({ success: false, error: '用户不存在' });
        }
        const now = new Date();
        let isExpired = false;
        let remainingDays = null;
        if (user.expires_at) {
            const expiresDate = new Date(user.expires_at);
            const diffTime = expiresDate - now;
            remainingDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            isExpired = diffTime <= 0;
        }
        res.json({
            success: true,
            data: {
                id: user.id,
                username: user.username,
                activation_code: user.activation_code,
                created_at: user.created_at,
                expires_at: user.expires_at,
                remaining_days: remainingDays,
                is_expired: isExpired,
                is_permanent: !user.expires_at
            }
        });
    } catch (error) {
        console.error('获取用户信息错误:', error);
        res.json({ success: false, error: '获取用户信息失败' });
    }
});

// 3. 获取用户数据（需要登录）
app.post('/api/get-user-data', authenticateToken, (req, res) => {
    try {
        const userId = req.userId;
        res.json({
            success: true,
            student_status: memoryDB.student_status.filter(item => item.user_id == userId),
            education: memoryDB.education.filter(item => item.user_id == userId),
            degree: memoryDB.degree.filter(item => item.user_id == userId),
            exam: memoryDB.exam.filter(item => item.user_id == userId)
        });
    } catch (error) {
        res.json({ success: false, error: '获取数据失败' });
    }
});

// 4. 更新数据（需要登录）
app.post('/api/update-data', authenticateToken, (req, res) => {
    try {
        const { table, action, data, id } = req.body;   // 不再从 body 解构 userId
        const userId = req.userId;                      // 从 token 获取
        const validTables = ['student_status', 'education', 'degree', 'exam'];
        if (!validTables.includes(table)) {
            return res.json({ success: false, error: '无效的表名' });
        }
        const tableData = memoryDB[table];
        
        switch (action) {
            case 'insert':
                const newId = Date.now();
                const newRecord = {
                    id: newId,
                    user_id: userId,
                    ...data,
                    created_at: new Date().toISOString()
                };
                tableData.push(newRecord);
                res.json({ success: true, message: '添加成功' });
                break;
            case 'update':
                const recordIndex = tableData.findIndex(item => item.id == id && item.user_id == userId);
                if (recordIndex === -1) {
                    return res.json({ success: false, error: '记录未找到' });
                }
                tableData[recordIndex] = { ...tableData[recordIndex], ...data };
                res.json({ success: true, message: '更新成功' });
                break;
            case 'delete':
                const deleteIndex = tableData.findIndex(item => item.id == id && item.user_id == userId);
                if (deleteIndex === -1) {
                    return res.json({ success: false, error: '记录未找到' });
                }
                tableData.splice(deleteIndex, 1);
                res.json({ success: true, message: '删除成功' });
                break;
            default:
                return res.json({ success: false, error: '无效的操作类型' });
        }
    } catch (error) {
        console.error('更新数据错误:', error);
        res.json({ success: false, error: '操作失败' });
    }
});

// 5. 获取学籍报告（需要登录）
app.post('/api/get-report', authenticateToken, (req, res) => {
    try {
        const userId = req.userId;
        const report = memoryDB.reports.find(r => r.user_id == userId);
        res.json({ success: true, data: report || null });
    } catch (error) {
        console.error('获取报告失败:', error);
        res.json({ success: false, error: '获取报告失败' });
    }
});

// 6. 保存学籍报告（需要登录）
app.post('/api/save-report', authenticateToken, (req, res) => {
    try {
        const userId = req.userId;
        const { data } = req.body;
        const existingIndex = memoryDB.reports.findIndex(r => r.user_id == userId);
        if (existingIndex === -1) {
            memoryDB.reports.push({
                id: Date.now(),
                user_id: userId,
                ...data,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            });
        } else {
            memoryDB.reports[existingIndex] = {
                ...memoryDB.reports[existingIndex],
                ...data,
                updated_at: new Date().toISOString()
            };
        }
        res.json({ success: true, message: '保存成功' });
    } catch (error) {
        console.error('保存报告失败:', error);
        res.json({ success: false, error: '保存失败' });
    }
});

// 404处理
app.use('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'API端点不存在' });
    } else {
        res.status(404).send('页面不存在');
    }
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`🚀 学信档案系统已启动（内存数据库版）`);
    console.log(`⚠️  注意：使用内存数据库，重启服务器后数据会丢失`);
});
