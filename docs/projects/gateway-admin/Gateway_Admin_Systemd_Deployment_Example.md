# Gateway Admin Systemd Deployment Example

本文给出 `gateway-admin` 在 Linux 主机上的标准化 `systemd` 启动方式。

目标：

1. 生产私有 env 文件。
2. `start-prod.sh` 统一启动入口。
3. `systemd` 管理自启动、重启、日志与进程存活。

## 1. 推荐目录约定

```text
/opt/synapse/Synapse-Network/admin/gateway-admin
/etc/synapse/gateway-admin.env
/var/log/synapse/
```

## 2. 生产环境变量文件

```bash
sudo mkdir -p /etc/synapse
sudo cp /opt/synapse/Synapse-Network/admin/gateway-admin/.env.example /etc/synapse/gateway-admin.env
sudo chmod 600 /etc/synapse/gateway-admin.env
```

至少替换：

1. `ADMIN_DATABASE_DSN`
2. `GATEWAY_READONLY_DSN`
3. `GATEWAY_INTERNAL_BASE_URL`
4. `GATEWAY_INTERNAL_ADMIN_WALLET`
5. `GATEWAY_INTERNAL_JWT_SECRET`
6. `ADMIN_GATEWAY_ALLOWED_ORIGINS`

同时保证：

1. `environment=prod`
2. `ADMIN_GATEWAY_DEBUG=false`

## 3. systemd unit 示例

创建 `/etc/systemd/system/synapse-gateway-admin.service`：

```ini
[Unit]
Description=Synapse gateway-admin
After=network.target

[Service]
Type=forking
User=synapse
Group=synapse
WorkingDirectory=/opt/synapse/Synapse-Network/admin/gateway-admin
Environment=ADMIN_GATEWAY_ENV_FILE=/etc/synapse/gateway-admin.env
Environment=ADMIN_GATEWAY_START_MODE=prod
ExecStart=/bin/bash /opt/synapse/Synapse-Network/admin/gateway-admin/scripts/ops/start-prod.sh
ExecStop=/bin/bash /opt/synapse/Synapse-Network/admin/gateway-admin/scripts/ops/stop.sh
ExecReload=/bin/bash /opt/synapse/Synapse-Network/admin/gateway-admin/scripts/ops/restart.sh prod
PIDFile=/opt/synapse/Synapse-Network/admin/gateway-admin/run/gateway-admin.pid
Restart=always
RestartSec=3
TimeoutStartSec=30
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
```

## 4. 启用命令

```bash
sudo systemctl daemon-reload
sudo systemctl enable synapse-gateway-admin
sudo systemctl start synapse-gateway-admin
```

查看状态：

```bash
sudo systemctl status synapse-gateway-admin
```

重启：

```bash
sudo systemctl restart synapse-gateway-admin
```

停止：

```bash
sudo systemctl stop synapse-gateway-admin
```

## 5. 发布更新流程

```bash
cd /opt/synapse/Synapse-Network
git pull
cd admin/gateway-admin
.venv/bin/pip install -r requirements.txt
sudo systemctl restart synapse-gateway-admin
sudo systemctl status synapse-gateway-admin
```

如果修改了生产 env：

```bash
sudo vi /etc/synapse/gateway-admin.env
sudo systemctl restart synapse-gateway-admin
```

## 6. 排障建议

查看 systemd 日志：

```bash
sudo journalctl -u synapse-gateway-admin -n 100 --no-pager
```

查看应用日志：

```bash
tail -n 100 /opt/synapse/Synapse-Network/admin/gateway-admin/logs/gateway-admin.log
```

如果启动失败，优先检查：

1. `/etc/synapse/gateway-admin.env` 是否存在且权限正确。
2. `ADMIN_DATABASE_DSN` 和 `GATEWAY_READONLY_DSN` 是否能连通。
3. `GATEWAY_INTERNAL_JWT_SECRET` 是否已替换为真实值。
4. `.venv` 是否存在且依赖安装完整。

## 7. 选择这套链路的原因

1. 本地与生产入口完全分离，不再混用一个 `start.sh`。
2. 生产 env 从项目目录剥离，降低误提交和误覆盖风险。
3. systemd 接管自启动、重启和进程守护，避免手工 nohup 漂移。
4. 生产启动动作仍统一收口在 `start-prod.sh`。
