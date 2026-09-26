FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=pwuser:pwuser site ./site
COPY --chown=pwuser:pwuser server ./server
COPY --chown=pwuser:pwuser scripts ./scripts
USER pwuser
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
