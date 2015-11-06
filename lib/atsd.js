var os = require('os');

var net = require('net');
var dgram = require('dgram');

var netConnection;
var dgramSocket;

var debug;
var log;

var atsdHost;
var atsdPort;
var user;
var password;
var protocol;
var defaultEntity;

// globalPrefix.prefixCounter.{metrics.key}

var globalPrefix;
var counterPrefix;
var timerPrefix;
var gaugePrefix;
var setPrefix;

var patterns;

var globalKeySanitize;
var flushCounts;

var SERIES_COMMAND = 'series'; // ATSD network command elements
var ENTITY_FIELD = 'e';
var METRIC_FIELD = 'm';
var TAG_FIELD = 't';
var TIME_SECOND_FIELD = 's';

var stats = {};

var largeSpace = '                         ';

exports.init = function init(startup_time, config, events, logger) {
  debug = config.debug; // enable debug logging: true or false
  log = logger;

  config.atsd = config.atsd || {};

  atsdHost = config.atsd.host;            // ATSD hostname
  atsdPort = config.atsd.port;            // ATSD port
  user = config.atsd.user;                // username
  password = config.atsd.password;        // and password to log into ATSD
  protocol = config.atsd.protocol;        // protocol: 'tcp' or 'udp'
  defaultEntity = config.atsd.entityName; // default entity

  defaultEntity = config.atsd.entityName; // default entity

  globalPrefix = config.atsd.globalPrefix;   // prefix for every metric
  counterPrefix = config.atsd.counterPrefix; // prefix for counter metrics
  timerPrefix = config.atsd.timerPrefix;     // prefix for timer metrics
  gaugePrefix = config.atsd.gaugePrefix;     // prefix for gauge metrics
  setPrefix = config.atsd.setPrefix;         // prefix for set metrics

  patterns = config.atsd.patterns; // patterns to parse statsd metric names
  // example of patterns in config
  //
  // patterns: [
  //     {
  //         pattern: '.*\\.wordpress\\..*$',
  //         atsd_pattern: '<metric>.<>.<entity>.<metrics>.<tag:url>'
  //     }, ...
  // ]
  //
  // if metric name matches regexp pattern, it will be parsed according to atsd_pattern
  //
  // <metrics> denotes any number of metric tokens and can be used once per pattern
  // it can also be omitted: <entity>..<tag:url>
  //
  // <> denotes a token that will be excluded
  // e.g. <metric>.<>.<metric> pattern for metric token1.token2.token3
  // results in metric token1.token3
  //
  // NOTE: every '\' in pattern must be duplicated

  globalKeySanitize = config.keyNameSanitize; // sanitizing metric names (getting rid of forbidden characters): true or false
  flushCounts = config.flush_counts;          // processing flush counts: true or false

  debug = debug !== undefined ? debug : false; // by default no debug logging

  atsdPort = atsdPort !== undefined ? atsdPort : 8081;  // default port is 8081
  user = user !== undefined ? user : '';                // default username
  password = password !== undefined ? password : '';    // and password are blank
  protocol = protocol !== undefined ? protocol : 'tcp'; // default protocol is TCP
  defaultEntity = defaultEntity !== undefined ?
    defaultEntity : os.hostname();          // default entity is local hostname

  globalPrefix = globalPrefix !== undefined ? globalPrefix + '.' : '';             // default global prefix is blank
  counterPrefix = counterPrefix !== undefined ? counterPrefix + '.' : 'counters.'; // default counter prefix is 'counters'
  timerPrefix = timerPrefix !== undefined ? timerPrefix + '.' : 'timers.';         // default timer prefix is 'timers'
  gaugePrefix = gaugePrefix !== undefined ? gaugePrefix + '.' : 'gauges.';         // default gauge prefix is 'gauges'
  setPrefix = setPrefix !== undefined ? setPrefix + '.' : 'sets.';                 // default set prefix is 'sets'

  globalKeySanitize = globalKeySanitize !== undefined ? globalKeySanitize : true;                       // by default sanitize metric names
  flushCounts = flushCounts !== undefined ? typeof(flushCounts) === 'boolean' ? flushCounts : true : true; // by default process flush counts

  stats.last_flush = startup_time;
  stats.last_exception = startup_time;
  stats.flush_time = 0;
  stats.flush_length = 0;

  if (protocol.toLowerCase() === 'udp') {
    dgramSocket = dgram.createSocket('udp4');
  } else {
    function connect() {
      netConnection = net.connect(atsdPort, atsdHost, function () {
      });

      netConnection.on('error', function (err) {
        log.log(err);
        setTimeout(connect, 10000);
      });
    }

    connect();
  }

  events.on('flush', flush);
  events.on('status', backend_status);

  return true;
};

function parse(key) { // match metric name against pattern and parse according to atsd-pattern if matches
  // returns 3 string variables: entity, metric, tags
  // format for tags: ' t:tag1=value1 t:tag2=value2...'
  var keyParsed = {};

  for (var k = 0; k < patterns.length; k++) {
    var pattern = patterns[k];
    var regExp = new RegExp('' + pattern.pattern);
    var atsdPattern = pattern.atsd_pattern;

    if (regExp.test(key) === false) {
      continue;
    }

    var ids = atsdPattern.split('.');
    var tokens = key.split('.');

    var i, t;
    var id, token;

    var nonBlank = 0;

    for (i = 0; i < ids.length; i++) {
      id = ids[i];

      if (id !== '' && !/<metrics>/.test(id)) {
        nonBlank++;
      }
    }

    if (nonBlank > tokens.length) {
      log.log('too many tokens in pattern \'' + atsdPattern + '\' (' + nonBlank + ') for matching metric \'' + key + '\' (' + tokens.length + ')');
      continue;
    } else if (nonBlank === ids.length && nonBlank < tokens.length) {
      log.log('not enough tokens in pattern \'' + atsdPattern + '\' (' + nonBlank + ') for matching metric \'' + key + '\' (' + tokens.length + '): extra tokens are cropped');
    }

    var entityNamespace = [];
    var metricNamespace = [];
    var tags = {};

    var metricStart = -1;

    for (i = 0; i < ids.length, i < tokens.length; i++) {
      id = ids[i];
      token = tokens[i];

      if (/<entity>/.test(id)) {
        entityNamespace.push(token);
      } else if (/<metric>/.test(id)) {
        metricNamespace.push(token);
      } else if (/<tag:.*>/.test(id)) {
        tags[id.substring(5, id.length - 1)] = token;
      } else if (id === '' || /<metrics>/.test(id)) {
        metricStart = i;
        break;
      }
    }

    if (metricStart >= 0) {
      var metricEnd;
      var metricNamespaceReverse = [];

      i = ids.length - 1;
      t = tokens.length - 1;

      for (; i >= 0, t >= 0; i--, t--) {
        id = ids[i];
        token = tokens[t];

        if (/<metric>/.test(id)) {
          metricNamespaceReverse.push(token);
        } else if (/<tag:.*>/.test(id)) {
          tags[id.substring(5, id.length - 1)] = token;
        } else if (id === '' || /<metrics>/.test(id)) {
          metricEnd = t;
          break;
        }
      }

      for (t = metricStart; t <= metricEnd; t++) {
        metricNamespace.push(tokens[t]);
      }

      for (t = metricNamespaceReverse.length - 1; t >= 0; t--) {
        metricNamespace.push(metricNamespaceReverse[t]);
      }

    }

    if (metricNamespace.length < 1) {
      continue;
    }

    keyParsed.entityName = entityNamespace.join('.');
    keyParsed.entityName = keyParsed.entityName !== '' ? keyParsed.entityName : defaultEntity;
    keyParsed.metricName = metricNamespace.join('.');
    keyParsed.tags = tags;

    if (debug) {
      log.log('metric \'' + key + '\' matched pattern \'' + pattern.pattern + '\','
          + '\n' + largeSpace + 'split as \'' + atsdPattern + '\' into \''
          + SERIES_COMMAND
          + ' ' + ENTITY_FIELD + ':' + keyParsed.entityName
          + ' ' + METRIC_FIELD + ':' + keyParsed.metricName
          + '=...'
          + concatTags(tags)
          + '\''
      );
    }

    return keyParsed;

  }

  keyParsed.entityName = defaultEntity;
  keyParsed.metricName = key;
  keyParsed.tags = {};

  return keyParsed;
}

function concatTags(tags) {
  tagString = '';

  for (tagName in tags) {
    tagString += ' ' + TAG_FIELD + ':' + tagName + '=' + tags[tagName];
  }

  return tagString;
}

function flush(ts, metrics) { // generate ATSD network commands from metric stats and flush data into ATSD
  //parse('alfa.beta.charlie.delta');

  var startTime = Date.now();

  var commands = [];
  var numStats = 0;

  var key;
  var timer_data_key;

  var counters = metrics.counters;
  var gauges = metrics.gauges;
  //var timers = metrics.timers;
  var sets = metrics.sets;

  var counter_rates = metrics.counter_rates;
  var timer_data = metrics.timer_data;
  var statsd_metrics = metrics.statsd_metrics;

  function sanitize(key) {
    if (globalKeySanitize) {
      return key;
    } else {
      return key.replace(/\s+/g, '_')
        .replace(/\//g, '-')
        .replace(/[^a-zA-Z_\-0-9\.]/g, '');
    }
  }

  // overall process of metric flushing is the same for all types of metrics
  // going through all metrics of a particular type, parsing the name
  // according to patterns in config and creating an ATSD network command

  var keyParsed;
  var entityName;
  var metricName;
  var tagString;

  for (key in counters) {
    var value = counters[key];
    var valuePerSecond = counter_rates[key];

    keyParsed = parse(sanitize(key));

    entityName = keyParsed.entityName;
    metricName = keyParsed.metricName;
    tagString = concatTags(keyParsed.tags);

    commands.push(SERIES_COMMAND
        + ' ' + ENTITY_FIELD + ':' + entityName
        + ' ' + METRIC_FIELD + ':' + globalPrefix + counterPrefix + metricName + '.rate'
        + '=' + valuePerSecond
        + tagString
        + ' ' + TIME_SECOND_FIELD + ':' + ts
        + '\n'
    );

    if (flushCounts) {
      commands.push(SERIES_COMMAND
          + ' ' + ENTITY_FIELD + ':' + entityName
          + ' ' + METRIC_FIELD + ':' + globalPrefix + counterPrefix + metricName + '.count'
          + '=' + value
          + tagString
          + ' ' + TIME_SECOND_FIELD + ':' + ts
          + '\n'
      );
    }

    numStats += 1;
  }

  for (key in timer_data) {
    keyParsed = parse(sanitize(key));

    entityName = keyParsed.entityName;
    metricName = keyParsed.metricName;
    tagString = concatTags(keyParsed.tags);

    for (timer_data_key in timer_data[key]) {
      if (typeof(timer_data[key][timer_data_key]) === 'number') {
        commands.push(SERIES_COMMAND
            + ' ' + ENTITY_FIELD + ':' + entityName
            + ' ' + METRIC_FIELD + ':' + globalPrefix + timerPrefix + metricName + '.' + timer_data_key
            + '=' + timer_data[key][timer_data_key]
            + tagString
            + ' ' + TIME_SECOND_FIELD + ':' + ts
            + '\n'
        );
      } else {
        for (var timer_data_sub_key in timer_data[key][timer_data_key]) {
          if (debug) {
            log.log(timer_data[key][timer_data_key][timer_data_sub_key].toString());
          }

          commands.push(SERIES_COMMAND
              + ' ' + ENTITY_FIELD + ':' + entityName
              + ' ' + METRIC_FIELD + ':' + globalPrefix + timerPrefix + metricName + '.' + timer_data_key + '.' + timer_data_sub_key
              + '=' + timer_data[key][timer_data_key][timer_data_sub_key]
              + tagString
              + ' ' + TIME_SECOND_FIELD + ':' + ts
              + '\n'
          );
        }
      }
    }

    numStats += 1;
  }

  for (key in gauges) {
    keyParsed = parse(sanitize(key));

    entityName = keyParsed.entityName;
    metricName = keyParsed.metricName;
    tagString = concatTags(keyParsed.tags);

    commands.push(SERIES_COMMAND
        + ' ' + ENTITY_FIELD + ':' + entityName
        + ' ' + METRIC_FIELD + ':' + globalPrefix + gaugePrefix + metricName
        + '=' + gauges[key]
        + tagString
        + ' ' + TIME_SECOND_FIELD + ':' + ts
        + '\n'
    );

    numStats += 1;
  }

  for (key in sets) {
    keyParsed = parse(sanitize(key));

    entityName = keyParsed.entityName;
    metricName = keyParsed.metricName;
    tagString = concatTags(keyParsed.tags);

    commands.push(SERIES_COMMAND
        + ' ' + ENTITY_FIELD + ':' + entityName
        + ' ' + METRIC_FIELD + ':' + globalPrefix + setPrefix + metricName + '.count'
        + '=' + sets[key].size()
        + tagString
        + ' ' + TIME_SECOND_FIELD + ':' + ts
        + '\n'
    );

    numStats += 1;
  }
  /*
   commands.push(SERIES_COMMAND
   + ' ' + ENTITY_FIELD + ':' + defaultEntity
   + ' ' + METRIC_FIELD + ':' + globalPrefix + 'num_stats'
   + '=' + numStats
   + ' ' + TIME_SECOND_FIELD + ':' + ts
   + '\n'
   );

   commands.push(SERIES_COMMAND
   + ' ' + ENTITY_FIELD + ':' + defaultEntity
   + ' ' + METRIC_FIELD + ':' + globalPrefix + 'stats.calculation_time'
   + '=' + (Date.now() - startTime)
   + ' ' + TIME_SECOND_FIELD + ':' + ts
   + '\n'
   );

   for (key in statsd_metrics) {
   keyParsed = parse(sanitize(key));
   entityName = keyParsed.entityName;
   metricName = keyParsed.metricName;
   tagString = concatTags(keyParsed.tags);

   commands.push(SERIES_COMMAND
   + ' ' + ENTITY_FIELD + ':' + entityName
   + ' ' + METRIC_FIELD + ':' + globalPrefix + metricName
   + '=' + statsd_metrics[key]
   + tagString
   + ' ' + TIME_SECOND_FIELD + ':' + ts
   + '\n'
   );
   }

   if (debug) {
   log.log('numStats: ' + numStats);
   }
   */
  postStats(commands);
}

function postStats(commands) { // create a connection and flush data into ATSD
  var last_flush = stats.last_flush || 0;
  var last_exception = stats.last_exception || 0;
  var flush_time = stats.flush_time || 0;
  var flush_length = stats.flush_length || 0;

  if (atsdHost) {
    try {
      var ts = Math.round(new Date().getTime() / 1000);
      var startTime = Date.now();
      /*
       commands.push(SERIES_COMMAND
       + ' ' + ENTITY_FIELD + ':' + defaultEntity
       + ' ' + METRIC_FIELD + ':' + globalPrefix + 'stats.last_exception'
       + '=' + last_exception
       + ' ' + TIME_SECOND_FIELD + ':' + ts
       + '\n'
       );

       commands.push(SERIES_COMMAND
       + ' ' + ENTITY_FIELD + ':' + defaultEntity
       + ' ' + METRIC_FIELD + ':' + globalPrefix + 'stats.last_flush'
       + '=' + last_flush
       + ' ' + TIME_SECOND_FIELD + ':' + ts +
       '\n'
       );

       commands.push(SERIES_COMMAND
       + ' ' + ENTITY_FIELD + ':' + defaultEntity
       + ' ' + METRIC_FIELD + ':' + globalPrefix + 'stats.flush_time'
       + '=' + flush_time
       + ' ' + TIME_SECOND_FIELD + ':' + ts
       + '\n'
       );

       commands.push(SERIES_COMMAND
       + ' ' + ENTITY_FIELD + ':' + defaultEntity
       + ' ' + METRIC_FIELD + ':' + globalPrefix + 'stats.flush_length'
       + '=' + flush_length
       + ' ' + TIME_SECOND_FIELD + ':' + ts
       + '\n'
       );
       */
      var command = '';
      command_length = 0;

      for (var c = 0; c < commands.length; c++) {
        command += commands[c];

        if ((c + 1) % 100 === 0 || c === commands.length - 1) {
          if (protocol.toLowerCase() === 'udp') {
            var message = new Buffer('' + command);

            if (debug) {
              log.log('-UDP-> ' + atsdHost + ':' + atsdPort
                + '\n' + largeSpace + message.toString().replace(/\n/g, '\n' + largeSpace));
            }

            dgramSocket.send(
              message, 0, message.length, atsdPort, atsdHost, function (err, bytes) {
                if (err) {
                  log.log(err);
                }
              }
            );
          } else {
            if (debug) {
              netConnection.write(command);

                log.log('-TCP-> ' + atsdHost + ':' + atsdPort
                  + '\n' + largeSpace + (netConnection.write(command) ? 'SUCCESS' : 'FAILURE')
                  + '\n' + largeSpace + command.replace(/\n/g, '\n' + largeSpace));
            } else {
              netConnection.write(command);
            }
          }

          command_length += command.length;
          command = '';
        }
      }

      stats.flush_time = (Date.now() - startTime);
      stats.flush_length = command_length;
      stats.last_flush = Math.round(new Date().getTime() / 1000);
    } catch (e) {
      if (debug) {
        log.log(e);
      }

      stats.last_exception = Math.round(new Date().getTime() / 1000);
    }
  }
}

var backend_status = function status(writeCb) {
  for (var stat in stats) {
    writeCb(null, 'atsd', stat, stats[stat]);
  }
};