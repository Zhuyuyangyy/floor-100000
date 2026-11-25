# 魔搭 Docker 创空间镜像：单容器托管静态游戏 + NPC 决策代理。
#
# 为什么一个容器而不是两个创空间：
#   代理和静态资源必须同源。跨源要么加 CORS、要么再暴露一个域名，而比赛要求
#   「部署在魔搭创空间、全程公开可访问」——同源单容器是最少可失败的形态，
#   也让 `GET /api/npc/decide` 这类误用自然落在 405 上，不需要额外配置。
#
# 密钥边界：
#   NPC_API_KEY 只通过运行时环境变量注入（创空间密文变量），**不进镜像**。
#   构建阶段用 --build-arg 都拿不到它，因为它压根没在构建期被引用。

# ── 构建阶段 ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# 先只拷贝依赖清单：源码改动不会让依赖层失效。
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 拷贝构建所需文件后产出 dist。
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN npx vite build

# ── 运行阶段 ────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# 只带运行必需的东西：静态产物 + 代理进程。没有 src、没有 devDependencies。
COPY --from=build /app/dist ./dist
COPY server/npc-proxy.mjs ./server/npc-proxy.mjs

# 非 root 运行：容器被攻破时不给宿主级权限。
USER node

ENV NODE_ENV=production
ENV PORT=7860
ENV HOST=0.0.0.0

# 魔搭 Docker 创空间固定要求 7860。
EXPOSE 7860

# 健康检查让平台能判断容器是否真的可用（而不只是进程活着）。
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:7860/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 直接跑 node，不经过 npm：省一层进程，信号能直达，容器停止更干净。
CMD ["node", "server/npc-proxy.mjs"]