const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// JWT secret - in production, use environment variable
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_EXPIRY = '7d';

// Initialize SQLite database
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'members.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_no TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    url TEXT,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed default member zone content if empty
const contentCount = db.prepare('SELECT COUNT(*) as count FROM content').get();
if (contentCount.count === 0) {
  const insertContent = db.prepare(
    'INSERT INTO content (title, type, url, description, sort_order) VALUES (?, ?, ?, ?, ?)'
  );
  const seedData = [
    ['卫安舒专属优惠', 'purchase', 'https://shop.youzan.com/v2/showcase/homepage?alias=YOUR_ALIAS', '超级会员专享卫安舒产品折扣价，点击进入商城', 1],
    ['芯安舒专属优惠', 'purchase', 'https://shop.youzan.com/v2/showcase/homepage?alias=YOUR_ALIAS', '超级会员专享芯安舒产品折扣价，点击进入商城', 2],
    ['本月会员福利', 'info', '', '每月15日更新专属福利，请持续关注', 3],
    ['新品抢先购', 'purchase', '', '超级会员可提前48小时购买新品', 4],
    ['会员专属客服', 'info', '', '一对一专属服务，优先响应您的需求', 5],
  ];
  const insertMany = db.transaction((rows) => {
    for (const row of rows) insertContent.run(...row);
  });
  insertMany(seedData);
  console.log('✅ 已初始化会员专区默认内容');
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== Auth Middleware ====================
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: '请先登录' });
  }
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.member = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: '登录已过期，请重新登录' });
  }
}

// ==================== API Routes ====================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: '古洛安超级会员系统运行正常' });
});

// Register
app.post('/api/register', (req, res) => {
  const { name, phone, password } = req.body;

  if (!name || !phone || !password) {
    return res.json({ success: false, message: '请填写完整信息' });
  }
  if (phone.length < 11) {
    return res.json({ success: false, message: '请输入正确的手机号码' });
  }
  if (password.length < 6) {
    return res.json({ success: false, message: '密码至少6位' });
  }

  // Check if phone already registered
  const existing = db.prepare('SELECT id FROM members WHERE phone = ?').get(phone);
  if (existing) {
    return res.json({ success: false, message: '该手机号已注册' });
  }

  // Generate member number: GL + timestamp + random
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 5).toUpperCase();
  const memberNo = 'GL' + timestamp + random;

  // Hash password
  const passwordHash = bcrypt.hashSync(password, 10);

  // Insert member
  const result = db.prepare(
    'INSERT INTO members (member_no, name, phone, password_hash) VALUES (?, ?, ?, ?)'
  ).run(memberNo, name, phone, passwordHash);

  // Generate JWT
  const token = jwt.sign(
    { id: result.lastInsertRowid, memberNo, name },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );

  res.json({
    success: true,
    message: '注册成功！欢迎加入古洛安超级会员',
    data: { memberNo, name, token }
  });
});

// Login
app.post('/api/login', (req, res) => {
  const { memberNo, password } = req.body;

  if (!memberNo || !password) {
    return res.json({ success: false, message: '请输入会员号和密码' });
  }

  const member = db.prepare(
    'SELECT id, member_no, name, password_hash, status FROM members WHERE member_no = ?'
  ).get(memberNo.trim().toUpperCase());

  if (!member) {
    return res.json({ success: false, message: '会员号不存在' });
  }
  if (member.status !== 'active') {
    return res.json({ success: false, message: '该账号已被禁用，请联系客服' });
  }

  const validPassword = bcrypt.compareSync(password, member.password_hash);
  if (!validPassword) {
    return res.json({ success: false, message: '密码错误' });
  }

  const token = jwt.sign(
    { id: member.id, memberNo: member.member_no, name: member.name },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );

  res.json({
    success: true,
    message: '登录成功',
    data: { memberNo: member.member_no, name: member.name, token }
  });
});

// Get member zone content
app.get('/api/content', authMiddleware, (req, res) => {
  const items = db.prepare('SELECT * FROM content ORDER BY sort_order ASC').all();
  res.json({ success: true, data: items });
});

// Get member profile
app.get('/api/profile', authMiddleware, (req, res) => {
  const member = db.prepare(
    'SELECT member_no, name, phone, created_at FROM members WHERE id = ?'
  ).get(req.member.id);
  res.json({ success: true, data: member });
});

// Change password
app.post('/api/change-password', authMiddleware, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.json({ success: false, message: '请输入新旧密码' });
  }
  if (newPassword.length < 6) {
    return res.json({ success: false, message: '新密码至少6位' });
  }

  const member = db.prepare('SELECT password_hash FROM members WHERE id = ?').get(req.member.id);
  if (!bcrypt.compareSync(oldPassword, member.password_hash)) {
    return res.json({ success: false, message: '原密码错误' });
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE members SET password_hash = ? WHERE id = ?').run(newHash, req.member.id);
  res.json({ success: true, message: '密码修改成功' });
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🎯 古洛安超级会员系统已启动`);
  console.log(`   地址: http://localhost:${PORT}`);
  console.log(`   会员注册: http://localhost:${PORT}/`);
  console.log(`\n⚠️  重要提醒:`);
  console.log(`   1. 部署后需在公众号后台配置 JS 安全域名`);
  console.log(`   2. 需使用 HTTPS（微信强制要求）`);
  console.log(`   3. 请设置环境变量 JWT_SECRET 以保证安全\n`);
});