# 古洛安超级会员专区

基于 WeChat H5 的会员管理系统，支持自助注册、会员号+密码登录、专属内容展示。

## 功能

- ✅ 会员自助注册（自动生成会员号 GLxxxxxx）
- ✅ 会员号+密码登录
- ✅ 会员专属内容展示（购买链接、优惠信息等）
- ✅ 个人资料查看
- ✅ 密码修改
- ✅ 手机号防重复注册
- ✅ 300人规模，SQLite数据库
- ✅ 移动端适配（符合微信H5标准）
- ✅ 古洛安品牌配色（墨蓝+香槟金+暖白）

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 启动服务
npm start

# 3. 访问：http://localhost:3000
```

## 部署到生产环境

### 方案一：Vercel（推荐，免费HTTPS）

1. 注册 https://vercel.com
2. 安装 Vercel CLI: `npm i -g vercel`
3. 在项目目录运行: `vercel`
4. 获取 HTTPS 域名（如 guluan-member.vercel.app）

**注意**：Vercel 是 Serverless 架构，需要改造：
- 将 server.js 改为 Vercel Serverless Functions
- 数据库改为 Vercel KV 或外部数据库

### 方案二：自建服务器部署（推荐）

```bash
# 在服务器上
git clone <本项目>
cd guluan-member-zone
npm install

# 使用 PM2 守护进程
npm i -g pm2
pm2 start server.js --name guluan-member
pm2 save
pm2 startup

# 配置 Nginx 反向代理 + HTTPS
# 示例 nginx 配置见下方
```

### Nginx 配置示例

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 微信公众平台配置

部署获得 HTTPS 域名后，在公众号后台配置：

1. **设置 JS 安全域名**
   - 登录 mp.weixin.qq.com → 设置 → 公众号设置 → 功能设置
   - 在"JS接口安全域名"中添加你的域名
   - 上传验证文件到服务器

2. **设置自定义菜单**
   - 功能 → 自定义菜单 → 添加菜单
   - 菜单名称：超级会员专区
   - 菜单类型：跳转网页
   - 页面地址：https://your-domain.com

## 管理会员内容

修改 `server.js` 中的种子数据，或直接操作 SQLite 数据库：

```sql
-- 查看会员列表
SELECT * FROM members;

-- 添加会员专区内容
INSERT INTO content (title, type, url, description, sort_order) 
VALUES ('新内容', 'purchase', 'https://...', '描述', 6);

-- 删除内容
DELETE FROM content WHERE id = ?;

-- 禁用会员
UPDATE members SET status = 'inactive' WHERE member_no = 'GLxxxxxx';
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| PORT | 服务端口 | 3000 |
| JWT_SECRET | JWT 密钥（生产环境必须设置！） | 随机生成 |

```bash
export JWT_SECRET="your-random-secret-string"
export PORT=3000
npm start
```

## 安全建议

1. 生产环境必须设置环境变量 `JWT_SECRET`
2. 使用 HTTPS（微信强制要求）
3. 定期备份 `members.db`
4. 建议添加登录频次限制（防暴力破解）
5. 建议添加验证码（防机器人注册）

## 项目结构

```
guluan-member-zone/
├── server.js           # 后端 API（Express + SQLite）
├── public/
│   └── index.html      # 前端 H5 页面（单页应用）
├── package.json        # 依赖配置
├── members.db          # SQLite 数据库（自动创建）
└── .gitignore
```

## 技术栈

- 后端：Node.js + Express + better-sqlite3
- 认证：bcryptjs（密码哈希）+ jsonwebtoken（JWT）
- 前端：纯 HTML/CSS/JS（移动端优化）
- 数据库：SQLite（轻量，300用户规模完全够用）

## API 接口

| 方法 | 路径 | 说明 | 需要登录 |
|------|------|------|---------|
| POST | /api/register | 会员注册 | ❌ |
| POST | /api/login | 会员登录 | ❌ |
| GET | /api/content | 获取专区内容 | ✅ |
| GET | /api/profile | 获取会员资料 | ✅ |
| POST | /api/change-password | 修改密码 | ✅ |
| GET | /api/health | 健康检查 | ❌ |