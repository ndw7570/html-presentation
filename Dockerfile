FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# 의존성만 먼저 넣는다. 소스를 고쳐도 npm ci 단계 캐시가 살아 있어 다시 말기가 빠르다.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY lib ./lib
COPY public ./public

# 올린 발표는 이미지가 아니라 /data 에 쌓인다. 이미지를 다시 말아도 남는다.
ENV DATA_DIR=/data
ENV PORT=4300
RUN mkdir -p /data && chown -R node:node /data

USER node
EXPOSE 4300

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
