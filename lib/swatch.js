var Color, MIN_CONTRAST_BODY_TEXT, MIN_CONTRAST_TITLE_TEXT, Swatch, util;

util = require('./util');

Color = util.Color;


/*
  From Vibrant.js by Jari Zwarts
  Ported to node.js by AKFish

  Swatch class
 */

MIN_CONTRAST_TITLE_TEXT = 3.0;

MIN_CONTRAST_BODY_TEXT = 4.5;

module.exports = Swatch = (function() {
  Swatch.prototype.hsl = void 0;

  Swatch.prototype.rgb = void 0;

  Swatch.prototype.population = 1;

  Swatch.prototype.yiq = 0;

  function Swatch(rgb, population) {
    this.rgb = rgb;
    this.population = population;
  }

  Swatch.prototype.getHsl = function() {
    if (!this.hsl) {
      return this.hsl = util.rgbToHsl(this.rgb[0], this.rgb[1], this.rgb[2]);
    } else {
      return this.hsl;
    }
  };

  Swatch.prototype.getPopulation = function() {
    return this.population;
  };

  Swatch.prototype.getRgb = function() {
    return this.rgb;
  };

  Swatch.prototype.getHex = function() {
    return util.rgbToHex(this.rgb[0], this.rgb[1], this.rgb[2]);
  };

  Swatch.prototype.getTitleTextColor = function() {
    this._ensureTextColors();
    return this.titleTextColor;
  };

  Swatch.prototype.getBodyTextColor = function() {
    this._ensureTextColors();
    return this.bodyTextColor;
  };

  Swatch.prototype._ensureTextColors = function() {
    var argb, darkBodyAlpha, darkTitleAlpha, lightBodyAlpha, lightTitleAlpha;
    if (!this.generatedTextColors) {
      argb = [255, this.rgb[0], this.rgb[0], this.rgb[0]];
      lightBodyAlpha = util.calculateMinimumAlpha(Color.WHITE, argb, MIN_CONTRAST_BODY_TEXT);
      lightTitleAlpha = util.calculateMinimumAlpha(Color.WHITE, argb, MIN_CONTRAST_TITLE_TEXT);
      if ((lightBodyAlpha !== -1) && (lightTitleAlpha !== -1)) {
        this.bodyTextColor = util.setAlphaComponent(Color.WHITE, lightBodyAlpha);
        this.titleTextColor = util.setAlphaComponent(Color.WHITE, lightTitleAlpha);
        this.generatedTextColors = true;
        return void 0;
      }
      darkBodyAlpha = util.calculateMinimumAlpha(Color.BLACK, argb, MIN_CONTRAST_BODY_TEXT);
      darkTitleAlpha = util.calculateMinimumAlpha(Color.BLACK, argb, MIN_CONTRAST_TITLE_TEXT);
      if ((darkBodyAlpha !== -1) && (darkBodyAlpha !== -1)) {
        this.bodyTextColor = util.setAlphaComponent(Color.BLACK, darkBodyAlpha);
        this.titleTextColor = util.setAlphaComponent(Color.BLACK, darkTitleAlpha);
        this.generatedTextColors = true;
        return void 0;
      }
      console.log;
      console.log;
      console.log('@bodyTextColor');
      console.log(this.bodyTextColor);
      console.log;
      console.log('@titleTextColor');
      console.log(this.titleTextColor);
      console.log;
      console.log;
      this.bodyTextColor = lightBodyAlpha !== -1 ? util.setAlphaComponent(Color.WHITE, lightBodyAlpha) : util.setAlphaComponent(Color.BLACK, darkBodyAlpha);
      this.titleTextColor = lightTitleAlpha !== -1 ? util.setAlphaComponent(Color.WHITE, lightTitleAlpha) : util.setAlphaComponent(Color.BLACK, darkTitleAlpha);
      return this.generatedTextColors = true;
    }
  };

  return Swatch;

})();
