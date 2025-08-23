import { Redis } from "@upstash/redis";

const redisClient = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

//redisClient.on('error', err => console.error('❌ Redis Error:', err));

//await redisClient.connect();

export default redisClient;
