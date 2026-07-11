# 圆桌助手

一款服务线下阿瓦隆桌局的 Web 助手。它负责身份分配、秘密任务票、规则判断和进度记录；发言、组队讨论、公开亮票、观察反应和刺杀指认仍由玩家面对面完成。

![手机首页](product/design/concepts/waiting-room.webp)

## 当前能力

- 5 至 10 人创建和加入桌局，支持房间号与二维码；
- 经典、进阶角色组合及两种连续否决规则；
- 私密身份查看与正确的角色已知信息；
- 队长组队、现场同时亮票倒计时和否决记录；
- 匿名任务票、双失败判断和公共屏统一揭晓；
- 三次成功后的刺杀、三次失败结算和全员身份公开；
- 刷新或短暂断线后回到原座位、原身份和当前进度；
- 开局前换空座位，结算后原座位再来一局；
- 电脑、平板或电视可打开只显示公开信息的公共桌面。

## 本地运行

需要 Node.js 22 和 pnpm。

```bash
pnpm install
pnpm dev
```

打开 `http://localhost:4173`。同桌其他设备需要通过一个它们也能访问的地址打开网页；正式使用时建议部署到 HTTPS 域名。

## 检查与构建

```bash
pnpm test:all
```

也可以分别运行：

```bash
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm test:e2e
pnpm build
```

正式启动构建结果：

```bash
pnpm build
pnpm start
```

可通过 `PORT` 修改端口，通过 `ROOM_TTL_HOURS` 修改无活动房间的保留时长。

## 使用 Docker 部署到只有 IP 的服务器

项目已经提供 `Dockerfile` 和 `compose.yaml`。默认把服务器的 80 端口映射到应用，部署后直接访问：

```text
http://服务器IP
```

先把整个项目目录上传到服务器，然后在项目目录执行：

```bash
docker compose config
docker compose up -d --build
docker compose ps
```

确认服务正常：

```bash
curl http://127.0.0.1/api/health
```

正常时会返回包含 `"ok":true` 的结果。还需要在云服务器安全组中开放入站 TCP 80；不需要对外开放 4173。

常用维护命令：

```bash
# 查看最近日志
docker compose logs --tail=100

# 持续查看日志
docker compose logs -f

# 上传新代码后重新构建并更新
docker compose up -d --build

# 停止并移除容器
docker compose down
```

房主打开 `http://服务器IP` 创建桌局，其他玩家扫码加入。二维码会自动使用当前 IP 地址；公共屏仍通过房主页面中的入口打开。

该方案使用 HTTP，浏览器可能显示“不安全”。不要填写真实敏感信息。容器更新、重启或服务器重启会结束正在进行的桌局，因此请避开游戏过程中更新。

更完整的产品边界见 [产品文档](product/PRD.md)，运行方式与数据边界见 [交付说明](product/TECHNICAL.md)，验证结果见 [测试报告](product/QA.md)。
