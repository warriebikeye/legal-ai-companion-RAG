import { createClient } from 'redis';

const redisClient = createClient({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

redisClient.on('error', err => console.error('❌ Redis Error:', err));

await redisClient.connect();

export default redisClient;
