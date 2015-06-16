var debug;
var l;

var atsdHost;
var atsdPort;
var user;
var password;
var protocol;
var defaultEntity;

var globalPrefix;
var prefixCounter;
var prefixTimer;
var prefixGauge;
var prefixSet;

var patterns;

var globalKeySanitize;
var flushCounts;

var globalNamespace = [];
var counterNamespace = [];
var timerNamespace = [];
var gaugesNamespace = [];
var setsNamespace = [];

var prefixSeries;
var prefixMetric;
var suffixMetric;

var stats = {};

exports.init = function init(startup_time, config, events, logger) {

    debug = config.debug; // enable debug logging: true or false
    l = logger;

    config.atsd = config.atsd || {};

    atsdHost = config.atsd.host;        // ATSD hostname
    atsdPort = config.atsd.port;        // ATSD port
    user = config.atsd.user;            // username
    password = config.atsd.password;    // and password to log into ATSD
    protocol = config.atsd.protocol;    // protocol: "tcp" or "udp"
    defaultEntity = config.atsd.entity; // default entity

    globalPrefix = config.atsd.prefix;         // global prefix for every metric
    prefixCounter = config.atsd.prefixCounter; // prefix for counter metrics
    prefixTimer = config.atsd.prefixTimer;     // prefix for timer metrics
    prefixGauge = config.atsd.prefixGauge;     // prefix for gauge metrics
    prefixSet = config.atsd.prefixSet;         // prefix for set metrics

    patterns = config.atsd.patterns; // patterns to parse statsd metric names
    // example of patterns in config
    //
    // patterns: [
    //     {
    //         pattern: ".*\\.wordpress\\..*$",
    //         atsd_pattern: "<metric>.<>.<entity>.<metrics>.<tag:url>"
    //     }, ...
    // ]
    //
    // if metric name matches regexp pattern, it will be parsed according to atsd_pattern
    //
    // <metrics> denotes any number of tokens and can be used once per pattern
    // it can also be omitted: <entity>..<tag:url>
    //
    // <> denotes a token that will be excluded
    // e.g. <metric>.<>.<metric> pattern for metric token1.token2.token3
    // results in metric token1.token3
    //
    // NOTE: every "\" in pattern must be duplicated

    globalKeySanitize = config.keyNameSanitize; // sanitizing metric names (getting rid of forbidden characters): true or false
    flushCounts = config.flush_counts;          // processing flush counts: true or false

    debug = debug !== undefined ? debug : false; // by default no debug logging

    atsdPort = atsdPort !== undefined ? atsdPort : 8081;  // default port is 8081
    user = user !== undefined ? user : "";                // default username
    password = password !== undefined ? password : "";    // and password are blank
    protocol = protocol !== undefined ? protocol : "tcp"; // default protocol is TCP
    defaultEntity = defaultEntity !== undefined ?
        defaultEntity :require("os").hostname();          // default entity is local hostname

    globalPrefix = globalPrefix !== undefined ? globalPrefix : "";            // default global prefix is blank
    prefixCounter = prefixCounter !== undefined ? prefixCounter : "counters"; // default counter prefix is "counters"
    prefixTimer = prefixTimer !== undefined ? prefixTimer : "timers";         // default timer prefix is "timers"
    prefixGauge = prefixGauge !== undefined ? prefixGauge : "gauges";         // default gauge prefix is "gauges"
    prefixSet = prefixSet !== undefined ? prefixSet : "sets";                 // default set prefix is "sets"

    globalKeySanitize = globalKeySanitize !== undefined ? globalKeySanitize : true; // by default sanitize metric names
    flushCounts = typeof(flushCounts) !== "undefined" ? flushCounts : true;         // by default process flush counts

    prefixSeries = "series e:"; // ATSD network command elements
    prefixMetric = " m:";
    suffixMetric = "=";

    if (globalPrefix !== "") {
        globalNamespace.push(globalPrefix);
        counterNamespace.push(globalPrefix);
        timerNamespace.push(globalPrefix);
        gaugesNamespace.push(globalPrefix);
        setsNamespace.push(globalPrefix);
    }

    if (prefixCounter !== "") {
        counterNamespace.push(prefixCounter);
    }

    if (prefixTimer !== "") {
        timerNamespace.push(prefixTimer);
    }

    if (prefixGauge !== "") {
        gaugesNamespace.push(prefixGauge);
    }

    if (prefixSet !== "") {
        setsNamespace.push(prefixSet);
    }

    stats.last_flush = startup_time;
    stats.last_exception = startup_time;
    stats.flush_time = 0;
    stats.flush_length = 0;

    events.on("flush", flush);
    events.on("status", backend_status);
    events.on("status", backend_status);

    return true;

};

function parseKey(key) { // match metric name against pattern and parse according to atsd-pattern if matches
    // returns 3 string variables: entity, metric, tags
    // format for tags: " t:tag1=value1 t:tag2=value2..."

    var command = {};

    for (var k = 0; k < patterns.length; k++) {

        var pattern = patterns[k];
        var regExp = new RegExp("" + pattern.pattern);
        var atsdPattern = pattern.atsd_pattern;

        if (regExp.test(key) == false) {
            continue;
        }

        var ids = atsdPattern.split(".");
        var tokens = key.split(".");

        var i, t;
        var id, token;

        var nonBlank = 0;

        for (i = 0; i < ids.length; i++) {

            id = ids[i];

            if (id != "" && !/<metrics>/.test(id)) {
                nonBlank++;
            }

        }

        if (nonBlank > tokens.length) {
            l.log("too many tokens in pattern \"" + atsdPattern + "\" (" + nonBlank + ") for matching metric \"" + key + "\" (" + tokens.length + ")");
            continue;
        } else if (nonBlank == ids.length && nonBlank < tokens.length) {
            l.log("not enough tokens in pattern \"" + atsdPattern + "\" (" + nonBlank + ") for matching metric \"" + key + "\" (" + tokens.length + "): extra tokens are cropped");
        }

        var entityNamespace = [];
        var metricNamespace = [];
        var tagString = "";

        var metricCount = 0;
        var metricStart = -1;

        for (i = 0; i < ids.length, i < tokens.length; i++) {

            id = ids[i];
            token = tokens[i];

            if (/<entity>/.test(id)) {
                entityNamespace.push(token);
            } else if (/<metric>/.test(id)) {
                metricNamespace.push(token);
                metricCount++;
            } else if (/<tag:.*>/.test(id)) {
                tagString += " t:" + id.substring(5, id.length - 1) + "=" + token;
            } else if (id == "" || /<metrics>/.test(id)) {
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
                    metricCount++;
                } else if (/<tag:.*>/.test(id)) {
                    tagString += " t:" + id.substring(5, id.length - 1) + "=" + token;
                } else if (id == "" || /<metrics>/.test(id)) {
                    metricEnd = t;
                    break;
                }

            }

            for (t = metricStart; t <= metricEnd; t++) {
                metricNamespace.push(tokens[t]);
                metricCount++;
            }

            for (t = metricNamespaceReverse.length - 1; t >= 0; t--) {
                metricNamespace.push(metricNamespaceReverse[t]);
            }

        }

        if (metricCount < 1) {

            continue;
        }

        command.entity = entityNamespace.join(".");
        command.metric = metricNamespace.join(".");
        command.tags = tagString;

        return command;

    }

    command.entity = "";
    command.metric = key;
    command.tags = "";

    return command;

}

function flush(ts, metrics) { // generate ATSD network commands from metric stats and flush data into ATSD

    var suffixTime = " s:" + ts + "\n";
    var starTime = Date.now();

    var statString = "";
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
            return key.replace(/\s+/g, "_")
                .replace(/\//g, "-")
                .replace(/[^a-zA-Z_\-0-9\.]/g, "");
        }
    }

    // overall process of metric flushing is the same for all types of metrics
    // going through all metrics of a particular type, parsing the name
    // according to patterns in config and creating an ATSD network command

    var keyParsed;
    var entity;
    var metricName;
    var suffixTags;

    var namespace;

    for (key in counters) {

        var value = counters[key];
        var valuePerSecond = counter_rates[key];

        keyParsed = parseKey(sanitize(key));
        entity = keyParsed.entity == "" ? defaultEntity : keyParsed.entity;
        metricName = keyParsed.metric;
        suffixTags = keyParsed.tags;

        namespace = counterNamespace.concat(metricName);

        statString += prefixSeries + entity + prefixMetric
            + namespace.concat("rate").join(".") + suffixMetric + valuePerSecond + suffixTags + suffixTime;

        if (flushCounts) {
            statString += prefixSeries + entity + prefixMetric
                + namespace.concat("count").join(".") + suffixMetric + value + suffixTags + suffixTime;
        }

        numStats += 1;

    }

    for (key in timer_data) {

        keyParsed = parseKey(sanitize(key));
        entity = keyParsed.entity == "" ? defaultEntity : keyParsed.entity;
        metricName = keyParsed.metric;
        suffixTags = keyParsed.tags;

        namespace = timerNamespace.concat(metricName);

        for (timer_data_key in timer_data[key]) {

            if (typeof(timer_data[key][timer_data_key]) === "number") {

                statString += prefixSeries + entity + prefixMetric
                    + namespace.join(".") + "." + timer_data_key + suffixMetric
                    + timer_data[key][timer_data_key] + suffixTags + suffixTime;

            } else {

                for (var timer_data_sub_key in timer_data[key][timer_data_key]) {

                    if (debug) {
                        l.log(timer_data[key][timer_data_key][timer_data_sub_key].toString());
                    }

                    statString += prefixSeries + entity + prefixMetric
                        + namespace.join(".") + "." + timer_data_key + "." + timer_data_sub_key + suffixMetric
                        + timer_data[key][timer_data_key][timer_data_sub_key] + suffixTags + suffixTime;

                }

            }

        }

        numStats += 1;

    }

    for (key in gauges) {

        keyParsed = parseKey(sanitize(key));
        entity = keyParsed.entity == "" ? defaultEntity : keyParsed.entity;
        metricName = keyParsed.metric;
        suffixTags = keyParsed.tags;

        namespace = gaugesNamespace.concat(metricName);
        statString += prefixSeries + entity + prefixMetric
            + namespace.join(".") + suffixMetric + gauges[key] + suffixTags + suffixTime;

        numStats += 1;

    }

    for (key in sets) {

        keyParsed = parseKey(sanitize(key));
        entity = keyParsed.entity == "" ? defaultEntity : keyParsed.entity;
        metricName = keyParsed.metric;
        suffixTags = keyParsed.tags;

        namespace = setsNamespace.concat(metricName);
        statString += prefixSeries + entity + prefixMetric
            + namespace.concat("count").join(".") + suffixMetric + sets[key].size() + suffixTags + suffixTime;

        numStats += 1;

    }

    namespace = globalNamespace;

    statString += prefixSeries + defaultEntity + prefixMetric
        + namespace.concat("num_stats"             ).join(".") + suffixMetric + numStats                 + suffixTime;
    statString += prefixSeries + defaultEntity + prefixMetric
        + namespace.concat("stats.calculation_time").join(".") + suffixMetric + (Date.now() - starTime) + suffixTime;

    for (key in statsd_metrics) {

        keyParsed = parseKey(sanitize(key));
        entity = keyParsed.entity == "" ? defaultEntity : keyParsed.entity;
        metricName = keyParsed.metric;
        suffixTags = keyParsed.tags;

        statString += prefixSeries + entity + prefixMetric
            + namespace.concat(metricName).join(".") + suffixMetric + statsd_metrics[key] + suffixTags + suffixTime;

    }

    postStats(statString);

    if (debug) {
        l.log("numStats: " + numStats);
    }

};

function postStats(statString) { // create a connection and flush data into ATSD

    var last_flush = stats.last_flush || 0;
    var last_exception = stats.last_exception || 0;
    var flush_time = stats.flush_time || 0;
    var flush_length = stats.flush_length || 0;

    if (atsdHost) {

        try {

            var ts = Math.round(new Date().getTime() / 1000);
            var suffixTime = " s:" + ts + "\n";
            var startTime = Date.now();

            var namespace = globalNamespace;

            statString += prefixSeries + defaultEntity + prefixMetric
                + namespace.concat("stats.last_exception").join(".") + suffixMetric + last_exception + suffixTime;
            statString += prefixSeries + defaultEntity + prefixMetric
                + namespace.concat("stats.last_flush"    ).join(".") + suffixMetric + last_flush     + suffixTime;
            statString += prefixSeries + defaultEntity + prefixMetric
                + namespace.concat("stats.flush_time"    ).join(".") + suffixMetric + flush_time     + suffixTime;
            statString += prefixSeries + defaultEntity + prefixMetric
                + namespace.concat("stats.flush_length"  ).join(".") + suffixMetric + flush_length   + suffixTime;

            if (protocol.toLowerCase() === "udp") {

                var dgram = require("dgram");
                var message = new Buffer(statString);
                var client = dgram.createSocket("udp4");

                client.send(
                    message, 0, message.length, atsdPort, atsdHost, function (err, bytes) {
                        if (err) throw err;
                        //l.log(message + "---> " + atsdHost + ":" + atsdPort);
                    }
                );

            } else {

                var net = require("net");
                var atsd = net.createConnection(atsdPort, atsdHost);

                atsd.addListener(
                    "error", function (connectionException) {
                        if (debug) {
                            l.log(connectionException);
                        }
                    }
                );

                atsd.on(
                    "connect", function () {
                        this.write(statString);
                        //l.log(statString + "---> " + atsdHost + ":" + atsdPort);
                        this.end();
                    }
                );

            }

            stats.flush_time = (Date.now() - startTime);
            stats.flush_length = statString.length;
            stats.last_flush = Math.round(new Date().getTime() / 1000);

        } catch (e) {

            if (debug) {
                l.log(e);
            }

            stats.last_exception = Math.round(new Date().getTime() / 1000);

        }

    }

};

var backend_status = function status(writeCb) {

    for (var stat in stats) {
        writeCb(null, "atsd", stat, stats[stat]);
    }

};

