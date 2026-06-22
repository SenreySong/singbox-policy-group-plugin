# 策略组自动整理

GUI.for.SingBox 插件，用于在核心启动前按可配置规则自动生成策略组，并插入未隐藏策略组。

## 功能

- 默认生成 `🇭🇰 HK Group`、`🇹🇼 TW Group`、`🇯🇵 JP Group`、`🇺🇸 US Group`、`🇦🇺 AU Group`、`🇩🇪 DE Group`。
- 支持在插件界面手动新增、删除、排序分组规则。
- 台湾组默认只包含名称中有 `CN2` 或 `CFT` 的节点，可在界面调整额外条件。
- 支持 `🌐 Other Group` 收纳未命中任何分组规则的真实节点。
- 自动跳过 GFS 中隐藏的策略组。
- 自动清理旧国家组残留引用，避免 `dependency not found`。

## 插件链接

```text
https://raw.githubusercontent.com/SenreySong/singbox-policy-group-plugin/main/plugin-policy-group-manager.js
```

## 聚合订阅源

```text
https://raw.githubusercontent.com/SenreySong/singbox-node-chain-plugin/main/plugin-subscription.json
```
