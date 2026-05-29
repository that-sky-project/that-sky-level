const { printF: printf } = require("@htmonkeyg/tformat");

var silence = false;

module.exports = {
  printf: function (format, ...args) {
    if (silence)
      return;
    printf(format, args);
  },
  silence: function (enable) {
    silence = !!enable;
  }
};
