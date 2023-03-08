import redisClient from './redis';
import dbClient from './db';

// retrieves authentication token from headers
async function getAuthToken(request) {
  const token = request.headers['x-token'];
  return `auth_${token}`;
}

// finds a user ID based on token passed to headers
async function findUserIdByToken(request) {
  const key = await getAuthToken(request);
  const userId = await redisClient.get(key);
  return userId || null;
}

// finds a user from db based on ID
async function findUserById(userId) {
  const userExistsArray = await dbClient.users.find(`ObjectId("${userId}")`).toArray();
  return userExistsArray[0] || null;
}

export {
  findUserIdByToken, findUserById,
};
