# 在容器里运行

[English](../docker.md) | 简体中文

`ghcr.io/noir017/talkcode` 只有网关本身：Node、ssh 客户端和 talkcode，不带任何智能体。所有智能体都跑在
[远程主机](remote-hosts.md)上，所以这个容器只需要能经 ssh 连到那些主机、经 HTTPS 连到聊天平台。每次发版都会
发布 `X.Y.Z` 并更新 `latest`，提供 amd64 和 arm64 两种架构。

```yaml
# docker-compose.yml
services:
  talkcode:
    image: ghcr.io/noir017/talkcode:latest
    container_name: talkcode
    restart: unless-stopped
    environment:
      - TZ=Asia/Shanghai
    ports:
      - "127.0.0.1:8787:8787"        # 用网页端时才需要
    volumes:
      - ./config:/home/talkcode/.config/talkcode
```

```yaml
# config/config.yaml
version: 1
platforms:
  web:
    type: webui
    token: ${WEB_TOKEN}              # 取自 config/.env
    host: 0.0.0.0                    # 发布的端口转到容器自己的网卡上，不是回环地址
hosts:
  devbox:
    ssh: me@10.0.0.5:22
agents:
  - id: cc
    harness: claude
    host: devbox
routing:
  default: cc
access:
  allowFrom: ["web:owner"]
```

然后按[远程主机](remote-hosts.md#配置一台主机)里的步骤配好密钥和主机。密钥和 `known_hosts` 放在这里的
`config/ssh/`，也就是容器里的 `~/.config/talkcode/ssh/`。在容器里生成密钥，文件的属主才对：

```bash
docker compose run --rm talkcode sh -c \
  'mkdir -p -m 700 ~/.config/talkcode/ssh && ssh-keygen -t ed25519 -N "" -f ~/.config/talkcode/ssh/id_ed25519 -C talkcode'
docker compose run --rm talkcode talkcode doctor
docker compose up -d
```

## 需要知道的

- **运行账号是 uid 1001。** 挂进去的 `config/` 必须属于它。想换成别的 uid，用 `docker/Dockerfile` 加
  `--build-arg UID=… --build-arg GID=…` 自己构建。
- **容器里不跑智能体。** 镜像去掉了 `harness: claude` 在本机运行时要用的 Claude Code 二进制（约 220 MB），
  所以没写 `host:` 的智能体会启动失败，报 "native binary not found"。
- **日志用 `docker logs talkcode` 看**（加 `-t` 显示时间）。不写日志文件。
- **重启容器会停掉它在各主机上起的智能体。** 更新就是一次重启。见[断网时](remote-hosts.md#断网时)。
- **[网页端](web-ui.md#终端)的终端面板**通过 unix socket 代理到一个 ttyd。ttyd 在某台主机上时，挂一个两个容器
  共用的目录，把 `terminal.socket` 指向其中的 socket。ttyd 必须和网关用同一个 uid 运行。
  `terminal.endCommand` 在这个容器里执行，所以要用网关的密钥经 ssh 去关主机上的 tmux：

  ```yaml
  terminal:
    enabled: true
    socket: /run/webui-term/webui-term.sock
    endCommand: [ssh, -F, none, -o, BatchMode=yes, -i, /home/talkcode/.config/talkcode/ssh/id_ed25519,
                 -o, UserKnownHostsFile=/home/talkcode/.config/talkcode/ssh/known_hosts,
                 -o, StrictHostKeyChecking=yes, me@devbox,
                 tmux, -L, web, kill-session, -t, "web-{topic}"]
  ```

## 更新

```bash
docker compose pull && docker compose up -d
```

也可以把 `docker/talkcode-host` 装成宿主机上的 `talkcode` 命令
（`sudo install -m 755 docker/talkcode-host /usr/local/bin/talkcode`）。它知道重启会切断正在跑的东西：

```bash
talkcode update        # 拉镜像；镜像变了就重建容器、等各主机连回来、清掉旧镜像
talkcode update --dry-run
talkcode status        # 版本，以及正在跑的轮次和定时任务
talkcode logs          # docker logs -t --tail 200
talkcode doctor        # 其余参数都交给容器里的 talkcode CLI
```

有轮次或定时任务正在跑时，`update` 和 `restart` 会拒绝执行并列出它们；加 `--force` 照样执行。
compose 文件默认读 `~/apps/talkcode` 里的（`TALKCODE_APP_DIR` 可以改）。
