const Redis = require('ioredis');
const {config} = require('.');

class RedisClient {
     static instance;
     static isConnected = false;

     constructor(){
          // prevent direct instantiation
     }

     static getInstance(){
          if(!RedisClient.instance){
               RedisClient.instance = new Redis(config.REDIS_URL, {
                    retryStrategy: (times) =>{
                         const delay = Math.min(times * 50, 2000);
                         return delay;
                    },
                    maxRetriesPerRequest: 3
               })

               RedisClient.setupEventListeners();
          }
          return RedisClient.instance;
     }

     static setupEventListeners(){
          RedisClient.instance.on('connect', () =>{
               RedisClient.isConnected = true;
               console.log("Connected to Redis");
          })

          RedisClient.instance.on('error', (error) =>{
               RedisClient.isConnected = false;
               console.error("Redis connection error", error);
          })

          RedisClient.instance.on('close', () =>{
               RedisClient.isConnected = false;
               console.warn("Redis connection closed");
          })

          RedisClient.instance.on('reconnecting', () =>{
               console.warn("Reconnecting to Redis...");
          })

          RedisClient.instance.on('ready', () =>{
               console.log("Redis client is ready");
          })

          RedisClient.instance.on('end', () =>{
               RedisClient.isConnected = false;
               console.warn("Redis connection ended");
          })
     }

     static async closeConnection(){
          if(RedisClient.instance){
               try{
                    await RedisClient.instance.quit();
                    console.log("Redis connection closed");
               }catch(error){
                    console.error("Error closing Redis connection: ", error);
               }
          }
     }

     static isReady(){
          return RedisClient.isConnected;
     }
}

module.exports = {
     redis: RedisClient.getInstance(),
     RedisClient
}
