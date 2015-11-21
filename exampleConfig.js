/*

 ----------------------------------------------------------------------------
 variable           | description                            | default value
 ----------------------------------------------------------------------------
 debug              | enable debug logging : true or false   | false
 keyNameSanitize    | sanitizing metric names                | true
                    | (getting rid of forbidden characters): |
                    | true or false                          |
 flush_counts       | processing flush counts: true or false | true
 ----------------------------------------------------------------------------
 atsd               | container for all backend-specific     | -
                    | options                                |
 ----------------------------------------------------------------------------
 atsd.host          | ATSD hostname                          | -
 atsd.port          | ATSD port                              | 8081
 atsd.user          | username                               | ""
 atsd.password      | and password to log into ATSD          | ""
 atsd.protocol      | protocol: "tcp" or "udp"               | "tcp"
 atsd.entity        | default entity                         | local hostname
 ----------------------------------------------------------------------------
 atsd.prefix        | global prefix for every metric         | ""
 atsd.prefixCounter | prefix for counter metrics             | "counters"
 atsd.prefixTimer   | prefix for timer metrics               | "timers"
 atsd.prefixGauge   | prefix for gauge metrics               | "gauges"
 atsd.prefixSet     | prefix for set metrics                 | "sets"
 ----------------------------------------------------------------------------
 atsd.patterns      | patterns to parse statsd metric names  | -
 ----------------------------------------------------------------------------

 an example of 'patterns' in config

 patterns: [
     {
         pattern: /^.+\.wordpress\..+$/,
         atsd_pattern: "<metric>.<>.<entity>.<metrics>.<tag:url>"
     }, ...
 ]

 if a metric name matches regexp 'pattern', it will be parsed according to 'atsd_pattern'

 if a metric name has more tokens than 'atsd_pattern', extra tokens are cropped

 let's assume the metric name in question is "alfa.bravo.charlie.delta"
 and the default entity is "zulu"

 <metric> denotes a metric token
 multiple occurrences are combined
 e.g. <metric>.<metric>.<metric> --->
      series e:zulu m:alfa.bravo.charlie ...

 <entity> denotes an entity token to replace the default entity
 multiple occurrences are combined
 e.g. <entity>.<metric>.<entity>.<metric> --->
      series e:alfa.charlie m:bravo.delta ...

 <tag:tag_name> denotes a token for the tag named tag_name
 e.g. <entity>.<tag:test>.<metric>.<metric> --->
      series e:alfa m:charlie.delta t:test=bravo ...

 <> denotes a token that will be excluded
 e.g. <entity>.<tag:test>.<>.<metric> --->
      series e:alfa m:delta t:test=bravo ...

 <metrics> denotes any number of metric tokens and can be used once per pattern
 it can also be omitted: <entity>..<tag:url>
 e.g. <entity>.<tag:test>.<metrics> --->
      series e:alfa m:charlie.delta t:test=bravo ...

*/


{
    atsd : {
        host: "atsd_server",
        port: 8081,
        protocol: "tcp",
        patterns: [
            {
                pattern: /^([^.]+\.){2}com\..+/,
                atsd_pattern: "<entity>.<>.<>.<metrics>"
            },
            {
                pattern: /.*/,
                atsd_pattern: "<entity>.<metrics>"
            }
        ]
    },
    port: 8125,
    backends: [ "./node_modules/atsd-statsd-backend/lib/atsd" ],
    debug: true
}
