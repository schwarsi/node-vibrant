util = require('./util')
Color = util.Color
###
  From Vibrant.js by Jari Zwarts
  Ported to node.js by AKFish

  Swatch class
###

MIN_CONTRAST_TITLE_TEXT = 3.0
MIN_CONTRAST_BODY_TEXT = 4.5

module.exports =

class Swatch
  hsl: undefined
  rgb: undefined
  population: 1
  yiq: 0

  constructor: (rgb, population) ->
    @rgb = rgb
    @population = population

  getHsl: ->
    if not @hsl
      @hsl = util.rgbToHsl @rgb[0], @rgb[1], @rgb[2]
    else @hsl

  getPopulation: ->
    @population

  getRgb: ->
    @rgb

  getHex: ->
    util.rgbToHex(@rgb[0], @rgb[1], @rgb[2])

  getTitleTextColor: ->
    @_ensureTextColors()
    @titleTextColor

  getBodyTextColor: ->
    @_ensureTextColors()
    @bodyTextColor

  _ensureTextColors: ->
    if not @generatedTextColors
      # text colors are of kind [alpha, r, g, b]

      argb = [255, @rgb[0], @rgb[0], @rgb[0]]

      lightBodyAlpha = util.calculateMinimumAlpha Color.WHITE, argb, MIN_CONTRAST_BODY_TEXT
      lightTitleAlpha = util.calculateMinimumAlpha Color.WHITE, argb, MIN_CONTRAST_TITLE_TEXT

      if (lightBodyAlpha != -1) && (lightTitleAlpha != -1)
          # If we found valid light values, use them and return
          @bodyTextColor = util.setAlphaComponent Color.WHITE, lightBodyAlpha
          @titleTextColor = util.setAlphaComponent Color.WHITE, lightTitleAlpha
          @generatedTextColors = true
          return undefined

      darkBodyAlpha = util.calculateMinimumAlpha Color.BLACK, argb, MIN_CONTRAST_BODY_TEXT
      darkTitleAlpha = util.calculateMinimumAlpha Color.BLACK, argb, MIN_CONTRAST_TITLE_TEXT

      if (darkBodyAlpha != -1) && (darkBodyAlpha != -1)
          # If we found valid dark values, use them and return
          @bodyTextColor = util.setAlphaComponent Color.BLACK, darkBodyAlpha
          @titleTextColor = util.setAlphaComponent Color.BLACK, darkTitleAlpha
          @generatedTextColors = true
          return undefined

      # If we reach here then we can not find title and body values which use the same
      # lightness, we need to use mismatched values
      @bodyTextColor = if lightBodyAlpha != -1 then util.setAlphaComponent Color.WHITE, lightBodyAlpha else util.setAlphaComponent Color.BLACK, darkBodyAlpha
      @titleTextColor = if lightTitleAlpha != -1 then util.setAlphaComponent Color.WHITE, lightTitleAlpha else util.setAlphaComponent Color.BLACK, darkTitleAlpha

      @generatedTextColors = true
