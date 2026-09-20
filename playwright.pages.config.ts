import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./test/pages',timeout:90000,workers:1,use:{baseURL:'http://127.0.0.1:3214/StoryMode/',headless:true,viewport:{width:1440,height:1000},screenshot:'only-on-failure'},webServer:{command:'node test/pages-server.mjs',url:'http://127.0.0.1:3214/StoryMode/',reuseExistingServer:false,timeout:30000}});
