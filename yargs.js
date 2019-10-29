const yargs = require("yargs");

console.log("1", yargs.option("test").argv);

yargs
    .command(
        ["$0 [a]"],
        "test a",
        cmd =>
            cmd.positional("a", {
                type: "string",
                default: 5
            }),
        args => console.log("a", args)
    )
    .command(
        ["b <meh>"],
        "test b",
        cmd =>
            cmd.positional("meh", {
                type: "string"
            }),
        args => console.log("b", args)
    ).argv;
