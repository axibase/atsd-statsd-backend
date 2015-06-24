 ATSD StatsD Backend
=====================

 Purpose
---------

ATSD backend for StatsD enables you to forward metrics collected by StatsD daemon into Axibase Time-Series Database for retention, analytics, visualization, and alerting.

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
 `keyNameSanitize`    | sanitizing metric names  (remove forbidden characters): `true` or `false` | `true`
 `flush_counts`       | processing flush counts: `true` or `false`                                        | `true`
 `atsd`               | container for all backend-specific options                                        | -
 `atsd.host`          | ATSD hostname                                                                     | -
 `atsd.port`          | ATSD port                                                                         | `8081`
 `atsd.user`          | username                                                                          | `""`
 `atsd.password`      | password to log into ATSD                                                     | `""`
 `atsd.protocol`      | protocol: `"tcp"` or `"udp"`                                                      | `"tcp"`
 `atsd.entity`        | default entity                                                                    | local hostname
 `atsd.prefix`        | global prefix for each metric                                                    | `""`
 `atsd.prefixCounter` | prefix for counter metrics                                                        | `"counters"`
 `atsd.prefixTimer`   | prefix for timer metrics                                                          | `"timers"`
 `atsd.prefixGauge`   | prefix for gauge metrics                                                          | `"gauges"`
 `atsd.prefixSet`     | prefix for set metrics                                                            | `"sets"`
 `atsd.patterns`      | patterns to parse statsd metric names                                             | -

Other variables used by StatsD itself can be specified.

StatsD has an [open bug](https://github.com/etsy/statsd/issues/462) regarding the inability for configuration to sometimes reload during operation. Changing the configuration file while StatsD is running, may result in StatsD crashing. Until the bug is fixed, add `automaticConfigReload: false` to your configuration, restart StatsD for the changed configuration to take effect.

 Patterns
----------

Patterns enable the conversion of native StatsD metric names into ATSD entity/metric/tags.

If a metric name matches regexp pattern, it will be parsed according to `atsd_pattern`.

*NOTE: every \ in pattern must be duplicated.*

If a metric name has more tokens than `atsd_pattern`, extra tokens are cropped.

`alfa.bravo.charlie.delta` is used as an example metric and the default example entity is `zulu`.

 token            | description                                                                                           | atsd-pattern                            | result
------------------|-------------------------------------------------------------------------------------------------------|-----------------------------------------|--------------------------------------------------
 `<metric>`       | metric token; multiple occurrences are combined                                                       | `<metric>.<metric>.<metric>`            | `series e:zulu m:alfa.bravo.charlie ...`
 `<entity>`       | entity token to replace the default entity; multiple occurrences are combined                         | `<entity>.<metric>.<entity>.<metric>`   | `series e:alfa.charlie m:bravo.delta ...`
 `<tag:tag_name>` | token for the tag named `tag_name`                                                                    | `<entity>.<tag:test>.<metric>.<metric>` | `series e:alfa m:charlie.delta t:test=bravo ...`
 `<>`             | token to be excluded                                                                                  | `<entity>.<tag:test>.<>.<metric>`       | `series e:alfa m:delta t:test=bravo ...`
 `<metrics>`      | any number of metric tokens; can be used once per pattern; can also be omitted: `<entity>..<tag:url>` | `<entity>.<tag:test>.<metrics>`         | `series e:alfa m:charlie.delta t:test=bravo ...`
