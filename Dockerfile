# FROM node:23-alpine
FROM node:23-slim
WORKDIR /app
COPY package.json /app
RUN npm install
COPY ./*.js /app
COPY ./public /app/public
ENV PORT=8080

ARG S3_ENDPOINT
ARG S3_ACCESS_KEY_ID
ARG S3_SECRET_ACCESS_KEY

ARG MYSQL_ADDON_URI

ENV S3_ENDPOINT=$S3_ENDPOINT
ENV S3_ACCESS_KEY_ID=$S3_ACCESS_KEY_ID
ENV S3_SECRET_ACCESS_KEY=$S3_SECRET_ACCESS_KEY

ENV MYSQL_ADDON_URI=$MYSQL_ADDON_URI

USER node
EXPOSE 8080
CMD node index.js