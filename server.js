const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_EXPIRY = '7d';
const ADMIN_TOKEN_EXPIRY = '12h';

// Limits
const MEMBER_LIMITS = { xinanshu: 300, weianshu: 300 };

// Initialize SQLite database
const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'members.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ==================== Tables ====================
db.exec(`
  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    wechat_id TEXT,
    id_card TEXT,
    member_type TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    member_no TEXT,
    initial_password TEXT,
    reject_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    reviewed_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_no TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    member_type TEXT NOT NULL,
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
    body TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ==================== Seed Data ====================

// Seed admin account (default: admin / guluan2024)
const adminCount = db.prepare('SELECT COUNT(*) as count FROM admin_users').get();
if (adminCount.count === 0) {
  const adminHash = bcrypt.hashSync('guluan2024', 10);
  db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run('admin', adminHash);
  console.log('✅ 已创建管理员账号 admin / guluan2024');
}

// Seed content if empty
const contentCount = db.prepare('SELECT COUNT(*) as count FROM content').get();
if (contentCount.count === 0) {
  const insert = db.prepare('INSERT INTO content (title, type, description, body, sort_order) VALUES (?, ?, ?, ?, ?)');
  const seedData = [
    ['超级会员守则', 'rule', '古洛安超级会员专区规则与守则',
      '## 第一条 总则\n古洛安超级会员专区是为核心客户打造的专属服务平台，旨在提供更优质的产品与服务体验。\n\n## 第二条 会员资格\n1. 会员资格须经官方审核批准，不得自行注册。\n2. 会员号及初始密码由古洛安官方统一发放。\n3. 会员应妥善保管个人账号信息，不得转借他人使用。\n\n## 第三条 会员权益\n超级会员享有专属优惠价、新品优先体验、专属客服等特权，具体权益以专区公示为准。\n\n## 第四条 会员义务\n1. 遵守国家法律法规及本守则规定。\n2. 不得利用会员身份从事违法违规活动。\n3. 账号异常使用时，古洛安有权暂停或终止会员资格。\n\n## 第五条 守则修订\n古洛安保留对本守则的解释权与修订权，修订内容将在专区公示后生效。',
      1],
    ['芯安舒会员权益', 'benefit', '芯安舒超级会员专属权益说明',
      '## 🏷️ 芯安舒超级会员专属权益\n\n### 1. 专属折扣\n芯安舒全系列产品享受超级会员专属折扣价，普通用户无法享受。\n\n### 2. 新品抢先购\n新品上市前48小时，超级会员可提前下单，确保第一时间拿到心仪产品。\n\n### 3. 专属客服\n配备一对一专属客服，优先响应您的咨询与售后需求。\n\n### 4. 会员活动\n定期举办线上线下会员专属活动，精彩不容错过。\n\n### 5. 生日礼遇\n会员生日当月可领取专属生日礼包一份。\n\n📞 如有疑问请联系专属客服。',
      2],
    ['卫安舒会员权益', 'benefit', '卫安舒超级会员专属权益说明',
      '## 🏷️ 卫安舒超级会员专属权益\n\n### 1. 专属折扣\n卫安舒全系列产品享受超级会员专属折扣价，普通用户无法享受。\n\n### 2. 新品抢先购\n新品上市前48小时，超级会员可提前下单，确保第一时间拿到心仪产品。\n\n### 3. 专属客服\n配备一对一专属客服，优先响应您的咨询与售后需求。\n\n### 4. 会员活动\n定期举办线上线下会员专属活动，精彩不容错过。\n\n### 5. 生日礼遇\n会员生日当月可领取专属生日礼包一份。\n\n📞 如有疑问请联系专属客服。',
      3],
    ['卫安舒专属优惠', 'purchase', '超级会员专享卫安舒产品折扣价',
      '点击下方按钮进入卫安舒商城，享受超级会员专属价格。',
      4],
    ['芯安舒专属优惠', 'purchase', '超级会员专享芯安舒产品折扣价',
      '点击下方按钮进入芯安舒商城，享受超级会员专属价格。',
      5],
  ];
  const insertMany = db.transaction((rows) => {
    for (const row of rows) insert.run(...row);
  });
  insertMany(seedData);
  console.log('✅ 已初始化会员专区内容');
}

// ==================== Middleware ====================
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Member auth middleware
function memberAuth(req, res, next) {
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

// Admin auth middleware
function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: '请先登录管理后台' });
  }
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.isAdmin) {
      return res.status(403).json({ success: false, message: '无管理员权限' });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: '登录已过期，请重新登录' });
  }
}

// ==================== Helper Functions ====================
function generateMemberNo(type) {
  const prefix = type === 'xinanshu' ? 'XA' : 'WA';
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return prefix + timestamp + random;
}

function generateInitialPassword() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ==================== Public API ====================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: '古洛安超级会员系统运行正常' });
});

// Submit application (public, no auth needed)
app.post('/api/apply', (req, res) => {
  const { name, phone, wechat_id, id_card, member_type } = req.body;

  if (!name || !phone || !member_type) {
    return res.json({ success: false, message: '请填写必填信息（姓名、手机号、会员类型）' });
  }
  if (!/^1\d{10}$/.test(phone)) {
    return res.json({ success: false, message: '请输入正确的手机号码' });
  }
  if (!['xinanshu', 'weianshu'].includes(member_type)) {
    return res.json({ success: false, message: '请选择有效的会员类型' });
  }

  // Check if already applied
  const existing = db.prepare(
    'SELECT id, status FROM applications WHERE phone = ? AND member_type = ? AND status != ? ORDER BY id DESC LIMIT 1'
  ).get(phone, member_type, 'rejected');
  
  if (existing) {
    if (existing.status === 'pending') {
      return res.json({ success: false, message: '您的申请正在审核中，请耐心等待' });
    }
    if (existing.status === 'approved') {
      return res.json({ success: false, message: '您已通过审核，如忘记会员号请联系客服' });
    }
  }

  // Check type limit
  const typeCount = db.prepare(
    'SELECT COUNT(*) as count FROM members WHERE member_type = ? AND status = ?'
  ).get(member_type, 'active');
  
  const limit = MEMBER_LIMITS[member_type];
  if (typeCount.count >= limit) {
    const typeName = member_type === 'xinanshu' ? '芯安舒' : '卫安舒';
    return res.json({ success: false, message: `${typeName}会员名额已满（${limit}人），暂不接受申请` });
  }

  db.prepare(
    'INSERT INTO applications (name, phone, wechat_id, id_card, member_type) VALUES (?, ?, ?, ?, ?)'
  ).run(name, phone, wechat_id || '', id_card || '', member_type);

  res.json({ success: true, message: '申请已提交，我们将在1-3个工作日内审核，请留意客服通知' });
});

// Check application status
app.get('/api/apply/status', (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.json({ success: false, message: '请输入手机号查询' });

  const apps = db.prepare(
    'SELECT id, member_type, status, member_no, initial_password, created_at, reviewed_at FROM applications WHERE phone = ? ORDER BY id DESC LIMIT 5'
  ).all(phone);

  if (apps.length === 0) {
    return res.json({ success: false, message: '未找到申请记录' });
  }

  res.json({ success: true, data: apps.map(a => ({
    ...a,
    initial_password: undefined // Never expose password via API
  })) });
});

// ==================== Member API (requires auth) ====================

// Login
app.post('/api/login', (req, res) => {
  const { memberNo, password } = req.body;

  if (!memberNo || !password) {
    return res.json({ success: false, message: '请输入会员号和密码' });
  }

  const member = db.prepare(
    'SELECT id, member_no, name, member_type, password_hash, status FROM members WHERE member_no = ?'
  ).get(memberNo.trim().toUpperCase());

  if (!member) {
    return res.json({ success: false, message: '会员号不存在' });
  }
  if (member.status !== 'active') {
    return res.json({ success: false, message: '该账号已被禁用，请联系客服' });
  }

  if (!bcrypt.compareSync(password, member.password_hash)) {
    return res.json({ success: false, message: '密码错误' });
  }

  const token = jwt.sign(
    { id: member.id, memberNo: member.member_no, name: member.name, memberType: member.member_type },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );

  res.json({
    success: true,
    message: '登录成功',
    data: {
      memberNo: member.member_no,
      name: member.name,
      memberType: member.member_type,
      token
    }
  });
});

// Get member profile
app.get('/api/profile', memberAuth, (req, res) => {
  const member = db.prepare(
    'SELECT member_no, name, phone, member_type, created_at FROM members WHERE id = ?'
  ).get(req.member.id);
  res.json({ success: true, data: member });
});

// Change password
app.post('/api/change-password', memberAuth, (req, res) => {
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
  res.json({ success: true, message: '密码修改成功，请使用新密码重新登录' });
});

// Get member zone content
app.get('/api/content', memberAuth, (req, res) => {
  const items = db.prepare('SELECT * FROM content ORDER BY sort_order ASC').all();
  res.json({ success: true, data: items });
});

// ==================== Admin API ====================

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.json({ success: false, message: '请输入管理员账号和密码' });
  }

  const admin = db.prepare('SELECT id, username, password_hash FROM admin_users WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.json({ success: false, message: '账号或密码错误' });
  }

  const token = jwt.sign(
    { id: admin.id, username: admin.username, isAdmin: true },
    JWT_SECRET,
    { expiresIn: ADMIN_TOKEN_EXPIRY }
  );

  res.json({ success: true, message: '管理员登录成功', data: { username: admin.username, token } });
});

// Get applications list
app.get('/api/admin/applications', adminAuth, (req, res) => {
  const { status } = req.query;
  let apps;
  if (status && ['pending', 'approved', 'rejected'].includes(status)) {
    apps = db.prepare(
      'SELECT * FROM applications WHERE status = ? ORDER BY created_at DESC'
    ).all(status);
  } else {
    apps = db.prepare(
      'SELECT * FROM applications ORDER BY created_at DESC LIMIT 100'
    ).all();
  }
  res.json({ success: true, data: apps.map(a => ({ ...a, initial_password: undefined })) });
});

// Approve application
app.post('/api/admin/approve', adminAuth, (req, res) => {
  const { applicationId } = req.body;
  if (!applicationId) {
    return res.json({ success: false, message: '缺少申请ID' });
  }

  const app_rec = db.prepare('SELECT * FROM applications WHERE id = ? AND status = ?').get(applicationId, 'pending');
  if (!app_rec) {
    return res.json({ success: false, message: '申请不存在或已处理' });
  }

  // Check member limit
  const typeCount = db.prepare(
    'SELECT COUNT(*) as count FROM members WHERE member_type = ? AND status = ?'
  ).get(app_rec.member_type, 'active');

  const limit = MEMBER_LIMITS[app_rec.member_type];
  if (typeCount.count >= limit) {
    const typeName = app_rec.member_type === 'xinanshu' ? '芯安舒' : '卫安舒';
    return res.json({ success: false, message: `${typeName}会员名额已满（${limit}人）` });
  }

  const memberNo = generateMemberNo(app_rec.member_type);
  const initialPassword = generateInitialPassword();
  const passwordHash = bcrypt.hashSync(initialPassword, 10);

  // Create member
  db.prepare(
    'INSERT INTO members (member_no, name, phone, member_type, password_hash) VALUES (?, ?, ?, ?, ?)'
  ).run(memberNo, app_rec.name, app_rec.phone, app_rec.member_type, passwordHash);

  // Update application
  db.prepare(
    'UPDATE applications SET status = ?, member_no = ?, initial_password = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run('approved', memberNo, initialPassword, applicationId);

  // Get updated counts
  const newCount = db.prepare(
    'SELECT COUNT(*) as count FROM members WHERE member_type = ? AND status = ?'
  ).get(app_rec.member_type, 'active');

  res.json({
    success: true,
    message: '审核通过',
    data: {
      memberNo,
      initialPassword,
      name: app_rec.name,
      phone: app_rec.phone,
      memberType: app_rec.member_type,
      remaining: Math.max(0, MEMBER_LIMITS[app_rec.member_type] - newCount.count)
    }
  });
});

// Reject application
app.post('/api/admin/reject', adminAuth, (req, res) => {
  const { applicationId, reason } = req.body;
  if (!applicationId) {
    return res.json({ success: false, message: '缺少申请ID' });
  }

  const app_rec = db.prepare('SELECT * FROM applications WHERE id = ? AND status = ?').get(applicationId, 'pending');
  if (!app_rec) {
    return res.json({ success: false, message: '申请不存在或已处理' });
  }

  db.prepare(
    'UPDATE applications SET status = ?, reject_reason = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run('rejected', reason || '', applicationId);

  res.json({ success: true, message: '已拒绝该申请' });
});

// Get stats
app.get('/api/admin/stats', adminAuth, (req, res) => {
  const xinanshuCount = db.prepare(
    'SELECT COUNT(*) as count FROM members WHERE member_type = ? AND status = ?'
  ).get('xinanshu', 'active').count;

  const weianshuCount = db.prepare(
    'SELECT COUNT(*) as count FROM members WHERE member_type = ? AND status = ?'
  ).get('weianshu', 'active').count;

  const pendingCount = db.prepare(
    'SELECT COUNT(*) as count FROM applications WHERE status = ?'
  ).get('pending').count;

  res.json({
    success: true,
    data: {
      xinanshu: { current: xinanshuCount, limit: MEMBER_LIMITS.xinanshu },
      weianshu: { current: weianshuCount, limit: MEMBER_LIMITS.weianshu },
      pendingCount
    }
  });
});

// List all members
app.get('/api/admin/members', adminAuth, (req, res) => {
  const members = db.prepare(
    'SELECT id, member_no, name, phone, member_type, created_at, status FROM members ORDER BY created_at DESC'
  ).all();
  res.json({ success: true, data: members });
});

// ==================== Serve Frontend ====================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== Start ====================
app.listen(PORT, () => {
  console.log(`\n🎯 古洛安超级会员系统 v2.0 已启动`);
  console.log(`   地址: http://localhost:${PORT}`);
  console.log(`   管理员: admin / guluan2024`);
  console.log(`   用户申请: http://localhost:${PORT}/`);
  console.log(`   管理后台: http://localhost:${PORT}/#admin\n`);
});