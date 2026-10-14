FROM node:22-alpine
WORKDIR /app
COPY line-relay.js ./line-relay.js
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "line-relay.js"]
