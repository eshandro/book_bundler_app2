#!/usr/bin/env node
/***
 * Excerpted from "Node.js the Right Way",
 * published by The Pragmatic Bookshelf.
 * Copyrights apply to this code. It may not be used to create training material, 
 * courses, books, articles, and the like. Contact us if you are in doubt.
 * We make no guarantees that this code is fit for any purpose. 
 * Visit http://www.pragmaticprogrammer.com/titles/jwnode for more book information.
***/
'use strict';
const
  
  log = require('npmlog'),
  request = require('request'),
  
  express = require('express'),
  passport = require('passport'),
  session = require('express-session'),
  bodyParser = require('body-parser'),
  cookieParser = require('cookie-parser'),
  morgan = require('morgan'),
  serveStatic = require('serve-static'),
  app = express(),
  
  redisClient = require('redis').createClient(),
  RedisStore = require('connect-redis')(session),
  
  GoogleStrategy = require('passport-google-oauth').OAuth2Strategy;

// logging Redis events
redisClient
  .on('ready', function() { log.info('REDIS', 'ready'); })
  .on('error', function(err) { log.error('REDIS', err.message); });

// passport.serializeUser(function(user, done) {
//   done(null, user.identifier);
// });
// passport.deserializeUser(function(id, done) {
//   done(null, { identifier: id });
// });
// 
passport.serializeUser(function(user, done){
  done(null, user.id);
});
passport.deserializeUser(function(id, done){
  done(null, {id: id});
});


passport.use(new GoogleStrategy({
    clientID: '281349479660-c24p09s7v86133lvuocjn3fma611rttr.apps.googleusercontent.com',
    clientSecret: 'LMvo1O_yz23Ck6VCLXB1kX0-',
    callbackURL: 'http://localhost:3000/auth/google/return',
  },
  function(accessToken,refreshToken, profile, done) {
    // console.log("profile: ",profile);
    // User.findOrCreate({googleID: profile.id}, function (err, user) {
    //   return done(err, user);
    // });
    process.nextTick(function() {
      return done(null, {id: profile.id});
    });
  }
));

// app.use(express.logger('dev'));
app.use(morgan('combined'));
app.use(cookieParser());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));

app.use(session({
  secret: 'supersecretsecret',
  store: new RedisStore({
    host: "localhost",
    port: 3000,
    client: redisClient
    }),
  resave: false,
  saveUninitialized: true
}));
// Initialize Passport and restore authentication state, if any, from the session
app.use(passport.initialize());
app.use(passport.session());

// Static resources
app.use(serveStatic(__dirname + '/static'));
app.use(serveStatic(__dirname + '/bower_components'));

const config = {
  bookdb: 'http://localhost:5984/books/',
  b4db: 'http://localhost:5984/b4/'
};

require('./lib/book-search.js')(config, app);
require('./lib/field-search.js')(config, app);
require('./lib/bundle.js')(config, app);

app.get('/auth/google', 
  passport.authenticate('google', { scope : ['profile', 'email'] })
  );
app.get('/auth/google/return',
  passport.authenticate('google', { successRedirect: '/', failureRedirect: '/' })
);
app.get('/auth/logout', function(req, res){
  req.logout();
  res.redirect('/');
});

// Define a custom middleware that insures user is authorized
const authed = function(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  } else if (redisClient.ready) {
    res.status(403).json({
      error: "forbidden",
      reason: "not_authenticated"
    });
  } else {
    res.status(503).json({
      error: "service_unavailable",
      reason: "authentication_unavailable"
    });
  }
};

// Note the use authed func defined above as middleware on these routes
app.get('/api/user', authed, function(req, res){
  // console.log("req",req);
  res.json(req.user);
});

app.get('/api/user/bundles', authed, function(req, res) {
  var userURL = config.b4db + encodeURIComponent(req.user.id);
  request(userURL, function(err, couchRes, body) {
    if (err) {
      res.status(502).json( { error: "bad_gateway", reason: err.code });
    } else if (couchRes.statusCode === 200) {
      res.json(JSON.parse(body).bundles || {});
    } else {
      // res.send(couchRes.statusCode, body);
      console.log('get api/user/bundles JSON.parse(body)', JSON.parse(body));
      res.status(couchRes.statusCode).json(body);
    }
  });
});

app.put('/api/user/bundles', authed, function(req, res) {
  var userURL = config.b4db + encodeURIComponent(req.user.id);
  request(userURL, function(err, couchRes, body) {
    if (err) {
      res.status(502).json( { error: "bad_gateway", reason: err.code });
    } else if (couchRes.statusCode === 200) {
      var user = JSON.parse(body);
      user.bundles = req.body;
      request.put({ url: userURL, json: user }).pipe(res);
    } else if (couchRes.statusCode === 404) {
      var user = { bundles: req.body };
      request.put({ url: userURL,  json: user }).pipe(res);
    } else {
      res.status(couchRes.statusCode).json(body);
    }
  });
});

app.listen(3000, function(){
  console.log("ready captain.");
});

