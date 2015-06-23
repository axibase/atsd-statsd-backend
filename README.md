 ATSD StatsD Backend
=====================

 Purpose
---------

This backend is designed to convert StatsD metrics into
[ATSD API Network Command](https://axibase.com/atsd/api/#command:-series)
format and then flush the data into ATSD.

To learn how to use StatsD and its backends visit the project's [GitHub page](https://github.com/etsy/statsd).

 Config
--------

Configuration file example:

```
{
    atsd : {
        host: "192.168.1.233",
        port: 8082,
        protocol: "udp",
        patterns: [
            {
                pattern: "alfa\\..*\\.charlie\\..*$",
                atsd_pattern: "<entity>.<>.<tag:test>.<metric>"
            }
        ]
    },
    port: 8125,
    backends: [ "./backends/atsd" ],
    debug: true
}
```

Possible variables:

 variable             | description                                                                       | default value
----------------------|-----------------------------------------------------------------------------------|----------------
 `debug`              | enable debug logging : `true` or `false`                                          | `false`
 `keyNameSanitize`    | sanitizing metric names  (getting rid of forbidden characters): `true` or `false` | `true`
 `flush_counts`       | processing flush counts: `true` or `false`                                        | `true`
 `atsd`               | container for all backend-specific options                                        | -
 `atsd.host`          | ATSD hostname                                                                     | -
 `atsd.port`          | ATSD port                                                                         | `8081`
 `atsd.user`          | username                                                                          | `""`
 `atsd.password`      | and password to log into ATSD                                                     | `""`
 `atsd.protocol`      | protocol: `"tcp"` or `"udp"`                                                      | `"tcp"`
 `atsd.entity`        | default entity                                                                    | local hostname
 `atsd.prefix`        | global prefix for every metric                                                    | `""`
 `atsd.prefixCounter` | prefix for counter metrics                                                        | `"counters"`
 `atsd.prefixTimer`   | prefix for timer metrics                                                          | `"timers"`
 `atsd.prefixGauge`   | prefix for gauge metrics                                                          | `"gauges"`
 `atsd.prefixSet`     | prefix for set metrics                                                            | `"sets"`
 `atsd.patterns`      | patterns to parse statsd metric names                                             | -

You can specify other variables used by StatsD itself.

As of now StatsD team has an [open bug](https://github.com/etsy/statsd/issues/462) regarding the inability for config to reload on the fly at times. So, if you change the config file while StatsD is running, it might crush. Until the bug is fixed you can add `automaticConfigReload: false` to your config, but remember to restart StatsD for the changes to take effect.

 Patterns
----------

If a metric name matches regexp `pattern`, it will be parsed according to `atsd_pattern`.

**NOTE: every `\` in `pattern` must be duplicated.**

If a metric name has more tokens than `atsd_pattern`, extra tokens are cropped.

Let's assume the metric name in question is `alfa.bravo.charlie.delta` and the default entity is `zulu`.

 token            | description                                                                                           | atsd-pattern                            | result
------------------|-------------------------------------------------------------------------------------------------------|-----------------------------------------|--------------------------------------------------
 `<metric>`       | metric token; multiple occurrences are combined                                                       | `<metric>.<metric>.<metric>`            | `series e:zulu m:alfa.bravo.charlie ...`
 `<entity>`       | entity token to replace the default entity; multiple occurrences are combined                         | `<entity>.<metric>.<entity>.<metric>`   | `series e:alfa.charlie m:bravo.delta ...`
 `<tag:tag_name>` | token for the tag named `tag_name`                                                                    | `<entity>.<tag:test>.<metric>.<metric>` | `series e:alfa m:charlie.delta t:test=bravo ...`
 `<>`             | token to be excluded                                                                                  | `<entity>.<tag:test>.<>.<metric>`       | `series e:alfa m:delta t:test=bravo ...`
 `<metrics>`      | any number of metric tokens; can be used once per pattern; can also be omitted: `<entity>..<tag:url>` | `<entity>.<tag:test>.<metrics>`         | `series e:alfa m:charlie.delta t:test=bravo ...`
