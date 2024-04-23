FROM node:alpine

WORKDIR /usr/src/app

COPY package.json ./

RUN yarn --frozen-lockfile 

COPY . .

EXPOSE 3002
