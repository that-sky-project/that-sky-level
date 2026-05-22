const { IBinarying } = require("../../utils/helperClasses.js");

class LevelLod extends IBinarying {
  constructor() {
    super();
  }

  toStream(stream) {
    stream.writeBytes(Buffer.from("1B000100C0010000000000000000000000", "hex"));
  }
}

module.exports = {
  LevelLod
};
