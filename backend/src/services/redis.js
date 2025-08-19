import { createClient } from 'redis';

const redisClient = createClient({
  url: 'redis://localhost:6379' // or your cloud Redis endpoint
});

redisClient.on('error', err => console.error('❌ Redis Error:', err));

await redisClient.connect();

export default redisClient;
