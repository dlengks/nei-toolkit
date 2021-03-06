'use strict'
var express = require('express');
var velocity = require('express-velocity');
var ejs = require('ejs');
var path = require('path');
var http = require('http');

var rewrite = require('./middleware/rewrite');
var routeBoard = require('./middleware/routeBoard');
var folder = require('./middleware/folder');
var freemarker = require('../node-fmpp');
var nei = require('./nei');

var _ = require('./util');

function Server(options) {
  this.options = options || {};
  this.connection = [];
  
  this.init();
}

Server.prototype = {
  /**
   * 初始化服务
   */
  init: function () {
    var options = this.options;
    
    // 构建服务器
    /**
     * 当设置fallthrought为true的时候，当static file 找不到的时候，才会执行next()
     */
    var app = this.app = express({fallthrough: !!options.online});
    app.use(function (req, res, next) {
      req.on('data', function (chunk) {
        
      });
      req.on('end', function () {
        next();
      })
    });
    
    // 默认配置参数
    _.extend(options, {
      views: 'views',
      engine: {},
      port: 8000,
      https: false,  // 默认关闭https
      app: app,
      dir: process.cwd()
    });
    var server;
    if (options.https) {
      var https = require('https');
      var fs = require('fs');
      var serverOptions= {
        key: fs.readFileSync(require.resolve('./cert/server.key')),
        cert: fs.readFileSync(require.resolve('./cert/server.crt'))
      };
      server = this.server = https.createServer(serverOptions, app);
    } else {
      server = this.server = http.createServer(app);
    }
    
    if (typeof options.rules === 'string') {
      // 补全路由路径
      options.rules = path.resolve(options.rules);
    }
    
    // 设置视图路径
    options.views = path.resolve(options.dir, options.views);
    app.set('views', options.views);
    
    
    // 设置模板引擎
    var engine = _.isObject(options.engine) || {};
    engine.vm = velocity({root: [options.views]});
    engine.ftl = freemarker();
    engine.ejs = ejs.renderFile;
    if (options.nei && typeof options.engine === 'string') {
      // 针对nei，允许修改后缀和渲染引擎的对应关系
      var renderMap = {
        freemarker: freemarker(),
        ejs: ejs.renderFile,
        velocity: velocity({root: [options.views]})
      };
      var ext = options.ext;
      ext = ext.indexOf('.') === 0 ? ext.substr(1) : ext;
      
      if (renderMap[options.engine]) engine[ext] = renderMap[options.engine];
    }
    for (var i in engine) {
      if (engine.hasOwnProperty(i)) app.engine(i, engine[i]);
    }
  
  
    
    // 重写路由，生成路由代理
    if (options.rules) {
      app.use(rewrite(options));
    }
    // 跨域处理
    app.options("/*", function(req, res, next){
      var headers =  nei.getting().API_RES_HEADERS;
      Object.keys(headers).forEach(function (h) {
        res.header(h, headers[h]);
      });
      res.sendStatus(200);
    });
    
    // 处理访问根路径的情况，针对nei项目
    if (options.rules && options.nei) app.use(routeBoard(options));
    
    // 处理访问文件夹的情况
    app.use(folder(options));
    
    // 设置服务器根目录
    // 静态资源根目录不是必需的, 可以是直接 Mock 接口的需求
    if (options.dir) {
      app.use(express.static(options.dir));
    }
    
    
    if(options.online){
       let newRount =  nei.getRoutes({
         "ALL *": {}
       });
       app.use(rewrite({rules: newRount}));
    }
    
    
    // 异常控制
    app.use(function (err, req, res, next) {
      console.error(err.message || err);
      res.status(500).send('某些东东跪了ORZ……');
    });
    
    server.on('error', function (err) {
      if (err.code === 'EADDRINUSE') {
        // 接口已被使用，尝试接口加一
        console.log('端口' + options.port + '已被占用，尝试新端口' + (++options.port));
        setTimeout(() => {
          this.start();
        }, 1000);
      } else {
        console.error(err.stack);
      }
    }.bind(this));
    
    server.on('listening', function () {
      var url = `${options.https?'https': 'http'}://localhost:` + options.port;
      console.log('代理服务器已成功启动，当前根路径为 ' + url);
      // 自动打开浏览器
      if (options.launch) _.openBrowser(url);
    }.bind(this));
    
    server.on('close', function (err) {
      if (this.__isReset && !this.__reseting) {
        // 重置服务
        this.__isReset = false;
        
        if (err) {
          console.error('代理服务器重置失败，请使用ctrl+c关闭并重启')
          return process.exit(0);
        }
        
        console.log('正准备重置代理服务器......');
        this.__reseting = true;
        this.init();
        this.start();
      }
    }.bind(this));
    
    server.on('connection', function (socket) {
      this.connection.push(socket);
    }.bind(this));
  },
  /**
   * 开启服务
   */
  start: function () {
    this.tries = 1;
    if (this.tries++ >= 10) {
      console.error('尝试新端口过多，请手动切换到其他端口');
      return process.exit(0);
    }
    this.server.listen(this.options.port);
    
    this.__reseting = false; // 重置完成
  },
  /**
   * 重置服务
   */
  reset: function (options) {
    this.options = _.extend(this.options, options, true);
    this.options.launch = false;
    this.__isReset = true;
    
    var socket;
    while (socket = this.connection.pop()) {
      socket.destroy();
    }
    this.server.close();
  }
};

module.exports = Server;
