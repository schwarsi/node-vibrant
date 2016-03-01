(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (global){
/*! https://mths.be/punycode v1.4.0 by @mathias */
;(function(root) {

	/** Detect free variables */
	var freeExports = typeof exports == 'object' && exports &&
		!exports.nodeType && exports;
	var freeModule = typeof module == 'object' && module &&
		!module.nodeType && module;
	var freeGlobal = typeof global == 'object' && global;
	if (
		freeGlobal.global === freeGlobal ||
		freeGlobal.window === freeGlobal ||
		freeGlobal.self === freeGlobal
	) {
		root = freeGlobal;
	}

	/**
	 * The `punycode` object.
	 * @name punycode
	 * @type Object
	 */
	var punycode,

	/** Highest positive signed 32-bit float value */
	maxInt = 2147483647, // aka. 0x7FFFFFFF or 2^31-1

	/** Bootstring parameters */
	base = 36,
	tMin = 1,
	tMax = 26,
	skew = 38,
	damp = 700,
	initialBias = 72,
	initialN = 128, // 0x80
	delimiter = '-', // '\x2D'

	/** Regular expressions */
	regexPunycode = /^xn--/,
	regexNonASCII = /[^\x20-\x7E]/, // unprintable ASCII chars + non-ASCII chars
	regexSeparators = /[\x2E\u3002\uFF0E\uFF61]/g, // RFC 3490 separators

	/** Error messages */
	errors = {
		'overflow': 'Overflow: input needs wider integers to process',
		'not-basic': 'Illegal input >= 0x80 (not a basic code point)',
		'invalid-input': 'Invalid input'
	},

	/** Convenience shortcuts */
	baseMinusTMin = base - tMin,
	floor = Math.floor,
	stringFromCharCode = String.fromCharCode,

	/** Temporary variable */
	key;

	/*--------------------------------------------------------------------------*/

	/**
	 * A generic error utility function.
	 * @private
	 * @param {String} type The error type.
	 * @returns {Error} Throws a `RangeError` with the applicable error message.
	 */
	function error(type) {
		throw new RangeError(errors[type]);
	}

	/**
	 * A generic `Array#map` utility function.
	 * @private
	 * @param {Array} array The array to iterate over.
	 * @param {Function} callback The function that gets called for every array
	 * item.
	 * @returns {Array} A new array of values returned by the callback function.
	 */
	function map(array, fn) {
		var length = array.length;
		var result = [];
		while (length--) {
			result[length] = fn(array[length]);
		}
		return result;
	}

	/**
	 * A simple `Array#map`-like wrapper to work with domain name strings or email
	 * addresses.
	 * @private
	 * @param {String} domain The domain name or email address.
	 * @param {Function} callback The function that gets called for every
	 * character.
	 * @returns {Array} A new string of characters returned by the callback
	 * function.
	 */
	function mapDomain(string, fn) {
		var parts = string.split('@');
		var result = '';
		if (parts.length > 1) {
			// In email addresses, only the domain name should be punycoded. Leave
			// the local part (i.e. everything up to `@`) intact.
			result = parts[0] + '@';
			string = parts[1];
		}
		// Avoid `split(regex)` for IE8 compatibility. See #17.
		string = string.replace(regexSeparators, '\x2E');
		var labels = string.split('.');
		var encoded = map(labels, fn).join('.');
		return result + encoded;
	}

	/**
	 * Creates an array containing the numeric code points of each Unicode
	 * character in the string. While JavaScript uses UCS-2 internally,
	 * this function will convert a pair of surrogate halves (each of which
	 * UCS-2 exposes as separate characters) into a single code point,
	 * matching UTF-16.
	 * @see `punycode.ucs2.encode`
	 * @see <https://mathiasbynens.be/notes/javascript-encoding>
	 * @memberOf punycode.ucs2
	 * @name decode
	 * @param {String} string The Unicode input string (UCS-2).
	 * @returns {Array} The new array of code points.
	 */
	function ucs2decode(string) {
		var output = [],
		    counter = 0,
		    length = string.length,
		    value,
		    extra;
		while (counter < length) {
			value = string.charCodeAt(counter++);
			if (value >= 0xD800 && value <= 0xDBFF && counter < length) {
				// high surrogate, and there is a next character
				extra = string.charCodeAt(counter++);
				if ((extra & 0xFC00) == 0xDC00) { // low surrogate
					output.push(((value & 0x3FF) << 10) + (extra & 0x3FF) + 0x10000);
				} else {
					// unmatched surrogate; only append this code unit, in case the next
					// code unit is the high surrogate of a surrogate pair
					output.push(value);
					counter--;
				}
			} else {
				output.push(value);
			}
		}
		return output;
	}

	/**
	 * Creates a string based on an array of numeric code points.
	 * @see `punycode.ucs2.decode`
	 * @memberOf punycode.ucs2
	 * @name encode
	 * @param {Array} codePoints The array of numeric code points.
	 * @returns {String} The new Unicode string (UCS-2).
	 */
	function ucs2encode(array) {
		return map(array, function(value) {
			var output = '';
			if (value > 0xFFFF) {
				value -= 0x10000;
				output += stringFromCharCode(value >>> 10 & 0x3FF | 0xD800);
				value = 0xDC00 | value & 0x3FF;
			}
			output += stringFromCharCode(value);
			return output;
		}).join('');
	}

	/**
	 * Converts a basic code point into a digit/integer.
	 * @see `digitToBasic()`
	 * @private
	 * @param {Number} codePoint The basic numeric code point value.
	 * @returns {Number} The numeric value of a basic code point (for use in
	 * representing integers) in the range `0` to `base - 1`, or `base` if
	 * the code point does not represent a value.
	 */
	function basicToDigit(codePoint) {
		if (codePoint - 48 < 10) {
			return codePoint - 22;
		}
		if (codePoint - 65 < 26) {
			return codePoint - 65;
		}
		if (codePoint - 97 < 26) {
			return codePoint - 97;
		}
		return base;
	}

	/**
	 * Converts a digit/integer into a basic code point.
	 * @see `basicToDigit()`
	 * @private
	 * @param {Number} digit The numeric value of a basic code point.
	 * @returns {Number} The basic code point whose value (when used for
	 * representing integers) is `digit`, which needs to be in the range
	 * `0` to `base - 1`. If `flag` is non-zero, the uppercase form is
	 * used; else, the lowercase form is used. The behavior is undefined
	 * if `flag` is non-zero and `digit` has no uppercase form.
	 */
	function digitToBasic(digit, flag) {
		//  0..25 map to ASCII a..z or A..Z
		// 26..35 map to ASCII 0..9
		return digit + 22 + 75 * (digit < 26) - ((flag != 0) << 5);
	}

	/**
	 * Bias adaptation function as per section 3.4 of RFC 3492.
	 * https://tools.ietf.org/html/rfc3492#section-3.4
	 * @private
	 */
	function adapt(delta, numPoints, firstTime) {
		var k = 0;
		delta = firstTime ? floor(delta / damp) : delta >> 1;
		delta += floor(delta / numPoints);
		for (/* no initialization */; delta > baseMinusTMin * tMax >> 1; k += base) {
			delta = floor(delta / baseMinusTMin);
		}
		return floor(k + (baseMinusTMin + 1) * delta / (delta + skew));
	}

	/**
	 * Converts a Punycode string of ASCII-only symbols to a string of Unicode
	 * symbols.
	 * @memberOf punycode
	 * @param {String} input The Punycode string of ASCII-only symbols.
	 * @returns {String} The resulting string of Unicode symbols.
	 */
	function decode(input) {
		// Don't use UCS-2
		var output = [],
		    inputLength = input.length,
		    out,
		    i = 0,
		    n = initialN,
		    bias = initialBias,
		    basic,
		    j,
		    index,
		    oldi,
		    w,
		    k,
		    digit,
		    t,
		    /** Cached calculation results */
		    baseMinusT;

		// Handle the basic code points: let `basic` be the number of input code
		// points before the last delimiter, or `0` if there is none, then copy
		// the first basic code points to the output.

		basic = input.lastIndexOf(delimiter);
		if (basic < 0) {
			basic = 0;
		}

		for (j = 0; j < basic; ++j) {
			// if it's not a basic code point
			if (input.charCodeAt(j) >= 0x80) {
				error('not-basic');
			}
			output.push(input.charCodeAt(j));
		}

		// Main decoding loop: start just after the last delimiter if any basic code
		// points were copied; start at the beginning otherwise.

		for (index = basic > 0 ? basic + 1 : 0; index < inputLength; /* no final expression */) {

			// `index` is the index of the next character to be consumed.
			// Decode a generalized variable-length integer into `delta`,
			// which gets added to `i`. The overflow checking is easier
			// if we increase `i` as we go, then subtract off its starting
			// value at the end to obtain `delta`.
			for (oldi = i, w = 1, k = base; /* no condition */; k += base) {

				if (index >= inputLength) {
					error('invalid-input');
				}

				digit = basicToDigit(input.charCodeAt(index++));

				if (digit >= base || digit > floor((maxInt - i) / w)) {
					error('overflow');
				}

				i += digit * w;
				t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);

				if (digit < t) {
					break;
				}

				baseMinusT = base - t;
				if (w > floor(maxInt / baseMinusT)) {
					error('overflow');
				}

				w *= baseMinusT;

			}

			out = output.length + 1;
			bias = adapt(i - oldi, out, oldi == 0);

			// `i` was supposed to wrap around from `out` to `0`,
			// incrementing `n` each time, so we'll fix that now:
			if (floor(i / out) > maxInt - n) {
				error('overflow');
			}

			n += floor(i / out);
			i %= out;

			// Insert `n` at position `i` of the output
			output.splice(i++, 0, n);

		}

		return ucs2encode(output);
	}

	/**
	 * Converts a string of Unicode symbols (e.g. a domain name label) to a
	 * Punycode string of ASCII-only symbols.
	 * @memberOf punycode
	 * @param {String} input The string of Unicode symbols.
	 * @returns {String} The resulting Punycode string of ASCII-only symbols.
	 */
	function encode(input) {
		var n,
		    delta,
		    handledCPCount,
		    basicLength,
		    bias,
		    j,
		    m,
		    q,
		    k,
		    t,
		    currentValue,
		    output = [],
		    /** `inputLength` will hold the number of code points in `input`. */
		    inputLength,
		    /** Cached calculation results */
		    handledCPCountPlusOne,
		    baseMinusT,
		    qMinusT;

		// Convert the input in UCS-2 to Unicode
		input = ucs2decode(input);

		// Cache the length
		inputLength = input.length;

		// Initialize the state
		n = initialN;
		delta = 0;
		bias = initialBias;

		// Handle the basic code points
		for (j = 0; j < inputLength; ++j) {
			currentValue = input[j];
			if (currentValue < 0x80) {
				output.push(stringFromCharCode(currentValue));
			}
		}

		handledCPCount = basicLength = output.length;

		// `handledCPCount` is the number of code points that have been handled;
		// `basicLength` is the number of basic code points.

		// Finish the basic string - if it is not empty - with a delimiter
		if (basicLength) {
			output.push(delimiter);
		}

		// Main encoding loop:
		while (handledCPCount < inputLength) {

			// All non-basic code points < n have been handled already. Find the next
			// larger one:
			for (m = maxInt, j = 0; j < inputLength; ++j) {
				currentValue = input[j];
				if (currentValue >= n && currentValue < m) {
					m = currentValue;
				}
			}

			// Increase `delta` enough to advance the decoder's <n,i> state to <m,0>,
			// but guard against overflow
			handledCPCountPlusOne = handledCPCount + 1;
			if (m - n > floor((maxInt - delta) / handledCPCountPlusOne)) {
				error('overflow');
			}

			delta += (m - n) * handledCPCountPlusOne;
			n = m;

			for (j = 0; j < inputLength; ++j) {
				currentValue = input[j];

				if (currentValue < n && ++delta > maxInt) {
					error('overflow');
				}

				if (currentValue == n) {
					// Represent delta as a generalized variable-length integer
					for (q = delta, k = base; /* no condition */; k += base) {
						t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);
						if (q < t) {
							break;
						}
						qMinusT = q - t;
						baseMinusT = base - t;
						output.push(
							stringFromCharCode(digitToBasic(t + qMinusT % baseMinusT, 0))
						);
						q = floor(qMinusT / baseMinusT);
					}

					output.push(stringFromCharCode(digitToBasic(q, 0)));
					bias = adapt(delta, handledCPCountPlusOne, handledCPCount == basicLength);
					delta = 0;
					++handledCPCount;
				}
			}

			++delta;
			++n;

		}
		return output.join('');
	}

	/**
	 * Converts a Punycode string representing a domain name or an email address
	 * to Unicode. Only the Punycoded parts of the input will be converted, i.e.
	 * it doesn't matter if you call it on a string that has already been
	 * converted to Unicode.
	 * @memberOf punycode
	 * @param {String} input The Punycoded domain name or email address to
	 * convert to Unicode.
	 * @returns {String} The Unicode representation of the given Punycode
	 * string.
	 */
	function toUnicode(input) {
		return mapDomain(input, function(string) {
			return regexPunycode.test(string)
				? decode(string.slice(4).toLowerCase())
				: string;
		});
	}

	/**
	 * Converts a Unicode string representing a domain name or an email address to
	 * Punycode. Only the non-ASCII parts of the domain name will be converted,
	 * i.e. it doesn't matter if you call it with a domain that's already in
	 * ASCII.
	 * @memberOf punycode
	 * @param {String} input The domain name or email address to convert, as a
	 * Unicode string.
	 * @returns {String} The Punycode representation of the given domain name or
	 * email address.
	 */
	function toASCII(input) {
		return mapDomain(input, function(string) {
			return regexNonASCII.test(string)
				? 'xn--' + encode(string)
				: string;
		});
	}

	/*--------------------------------------------------------------------------*/

	/** Define the public API */
	punycode = {
		/**
		 * A string representing the current Punycode.js version number.
		 * @memberOf punycode
		 * @type String
		 */
		'version': '1.3.2',
		/**
		 * An object of methods to convert from JavaScript's internal character
		 * representation (UCS-2) to Unicode code points, and back.
		 * @see <https://mathiasbynens.be/notes/javascript-encoding>
		 * @memberOf punycode
		 * @type Object
		 */
		'ucs2': {
			'decode': ucs2decode,
			'encode': ucs2encode
		},
		'decode': decode,
		'encode': encode,
		'toASCII': toASCII,
		'toUnicode': toUnicode
	};

	/** Expose `punycode` */
	// Some AMD build optimizers, like r.js, check for specific condition patterns
	// like the following:
	if (
		typeof define == 'function' &&
		typeof define.amd == 'object' &&
		define.amd
	) {
		define('punycode', function() {
			return punycode;
		});
	} else if (freeExports && freeModule) {
		if (module.exports == freeExports) {
			// in Node.js, io.js, or RingoJS v0.8.0+
			freeModule.exports = punycode;
		} else {
			// in Narwhal or RingoJS v0.7.0-
			for (key in punycode) {
				punycode.hasOwnProperty(key) && (freeExports[key] = punycode[key]);
			}
		}
	} else {
		// in Rhino or a web browser
		root.punycode = punycode;
	}

}(this));

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],2:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

// If obj.hasOwnProperty has been overridden, then calling
// obj.hasOwnProperty(prop) will break.
// See: https://github.com/joyent/node/issues/1707
function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

module.exports = function(qs, sep, eq, options) {
  sep = sep || '&';
  eq = eq || '=';
  var obj = {};

  if (typeof qs !== 'string' || qs.length === 0) {
    return obj;
  }

  var regexp = /\+/g;
  qs = qs.split(sep);

  var maxKeys = 1000;
  if (options && typeof options.maxKeys === 'number') {
    maxKeys = options.maxKeys;
  }

  var len = qs.length;
  // maxKeys <= 0 means that we should not limit keys count
  if (maxKeys > 0 && len > maxKeys) {
    len = maxKeys;
  }

  for (var i = 0; i < len; ++i) {
    var x = qs[i].replace(regexp, '%20'),
        idx = x.indexOf(eq),
        kstr, vstr, k, v;

    if (idx >= 0) {
      kstr = x.substr(0, idx);
      vstr = x.substr(idx + 1);
    } else {
      kstr = x;
      vstr = '';
    }

    k = decodeURIComponent(kstr);
    v = decodeURIComponent(vstr);

    if (!hasOwnProperty(obj, k)) {
      obj[k] = v;
    } else if (isArray(obj[k])) {
      obj[k].push(v);
    } else {
      obj[k] = [obj[k], v];
    }
  }

  return obj;
};

var isArray = Array.isArray || function (xs) {
  return Object.prototype.toString.call(xs) === '[object Array]';
};

},{}],3:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

var stringifyPrimitive = function(v) {
  switch (typeof v) {
    case 'string':
      return v;

    case 'boolean':
      return v ? 'true' : 'false';

    case 'number':
      return isFinite(v) ? v : '';

    default:
      return '';
  }
};

module.exports = function(obj, sep, eq, name) {
  sep = sep || '&';
  eq = eq || '=';
  if (obj === null) {
    obj = undefined;
  }

  if (typeof obj === 'object') {
    return map(objectKeys(obj), function(k) {
      var ks = encodeURIComponent(stringifyPrimitive(k)) + eq;
      if (isArray(obj[k])) {
        return map(obj[k], function(v) {
          return ks + encodeURIComponent(stringifyPrimitive(v));
        }).join(sep);
      } else {
        return ks + encodeURIComponent(stringifyPrimitive(obj[k]));
      }
    }).join(sep);

  }

  if (!name) return '';
  return encodeURIComponent(stringifyPrimitive(name)) + eq +
         encodeURIComponent(stringifyPrimitive(obj));
};

var isArray = Array.isArray || function (xs) {
  return Object.prototype.toString.call(xs) === '[object Array]';
};

function map (xs, f) {
  if (xs.map) return xs.map(f);
  var res = [];
  for (var i = 0; i < xs.length; i++) {
    res.push(f(xs[i], i));
  }
  return res;
}

var objectKeys = Object.keys || function (obj) {
  var res = [];
  for (var key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) res.push(key);
  }
  return res;
};

},{}],4:[function(require,module,exports){
'use strict';

exports.decode = exports.parse = require('./decode');
exports.encode = exports.stringify = require('./encode');

},{"./decode":2,"./encode":3}],5:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var punycode = require('punycode');

exports.parse = urlParse;
exports.resolve = urlResolve;
exports.resolveObject = urlResolveObject;
exports.format = urlFormat;

exports.Url = Url;

function Url() {
  this.protocol = null;
  this.slashes = null;
  this.auth = null;
  this.host = null;
  this.port = null;
  this.hostname = null;
  this.hash = null;
  this.search = null;
  this.query = null;
  this.pathname = null;
  this.path = null;
  this.href = null;
}

// Reference: RFC 3986, RFC 1808, RFC 2396

// define these here so at least they only have to be
// compiled once on the first module load.
var protocolPattern = /^([a-z0-9.+-]+:)/i,
    portPattern = /:[0-9]*$/,

    // RFC 2396: characters reserved for delimiting URLs.
    // We actually just auto-escape these.
    delims = ['<', '>', '"', '`', ' ', '\r', '\n', '\t'],

    // RFC 2396: characters not allowed for various reasons.
    unwise = ['{', '}', '|', '\\', '^', '`'].concat(delims),

    // Allowed by RFCs, but cause of XSS attacks.  Always escape these.
    autoEscape = ['\''].concat(unwise),
    // Characters that are never ever allowed in a hostname.
    // Note that any invalid chars are also handled, but these
    // are the ones that are *expected* to be seen, so we fast-path
    // them.
    nonHostChars = ['%', '/', '?', ';', '#'].concat(autoEscape),
    hostEndingChars = ['/', '?', '#'],
    hostnameMaxLen = 255,
    hostnamePartPattern = /^[a-z0-9A-Z_-]{0,63}$/,
    hostnamePartStart = /^([a-z0-9A-Z_-]{0,63})(.*)$/,
    // protocols that can allow "unsafe" and "unwise" chars.
    unsafeProtocol = {
      'javascript': true,
      'javascript:': true
    },
    // protocols that never have a hostname.
    hostlessProtocol = {
      'javascript': true,
      'javascript:': true
    },
    // protocols that always contain a // bit.
    slashedProtocol = {
      'http': true,
      'https': true,
      'ftp': true,
      'gopher': true,
      'file': true,
      'http:': true,
      'https:': true,
      'ftp:': true,
      'gopher:': true,
      'file:': true
    },
    querystring = require('querystring');

function urlParse(url, parseQueryString, slashesDenoteHost) {
  if (url && isObject(url) && url instanceof Url) return url;

  var u = new Url;
  u.parse(url, parseQueryString, slashesDenoteHost);
  return u;
}

Url.prototype.parse = function(url, parseQueryString, slashesDenoteHost) {
  if (!isString(url)) {
    throw new TypeError("Parameter 'url' must be a string, not " + typeof url);
  }

  var rest = url;

  // trim before proceeding.
  // This is to support parse stuff like "  http://foo.com  \n"
  rest = rest.trim();

  var proto = protocolPattern.exec(rest);
  if (proto) {
    proto = proto[0];
    var lowerProto = proto.toLowerCase();
    this.protocol = lowerProto;
    rest = rest.substr(proto.length);
  }

  // figure out if it's got a host
  // user@server is *always* interpreted as a hostname, and url
  // resolution will treat //foo/bar as host=foo,path=bar because that's
  // how the browser resolves relative URLs.
  if (slashesDenoteHost || proto || rest.match(/^\/\/[^@\/]+@[^@\/]+/)) {
    var slashes = rest.substr(0, 2) === '//';
    if (slashes && !(proto && hostlessProtocol[proto])) {
      rest = rest.substr(2);
      this.slashes = true;
    }
  }

  if (!hostlessProtocol[proto] &&
      (slashes || (proto && !slashedProtocol[proto]))) {

    // there's a hostname.
    // the first instance of /, ?, ;, or # ends the host.
    //
    // If there is an @ in the hostname, then non-host chars *are* allowed
    // to the left of the last @ sign, unless some host-ending character
    // comes *before* the @-sign.
    // URLs are obnoxious.
    //
    // ex:
    // http://a@b@c/ => user:a@b host:c
    // http://a@b?@c => user:a host:c path:/?@c

    // v0.12 TODO(isaacs): This is not quite how Chrome does things.
    // Review our test case against browsers more comprehensively.

    // find the first instance of any hostEndingChars
    var hostEnd = -1;
    for (var i = 0; i < hostEndingChars.length; i++) {
      var hec = rest.indexOf(hostEndingChars[i]);
      if (hec !== -1 && (hostEnd === -1 || hec < hostEnd))
        hostEnd = hec;
    }

    // at this point, either we have an explicit point where the
    // auth portion cannot go past, or the last @ char is the decider.
    var auth, atSign;
    if (hostEnd === -1) {
      // atSign can be anywhere.
      atSign = rest.lastIndexOf('@');
    } else {
      // atSign must be in auth portion.
      // http://a@b/c@d => host:b auth:a path:/c@d
      atSign = rest.lastIndexOf('@', hostEnd);
    }

    // Now we have a portion which is definitely the auth.
    // Pull that off.
    if (atSign !== -1) {
      auth = rest.slice(0, atSign);
      rest = rest.slice(atSign + 1);
      this.auth = decodeURIComponent(auth);
    }

    // the host is the remaining to the left of the first non-host char
    hostEnd = -1;
    for (var i = 0; i < nonHostChars.length; i++) {
      var hec = rest.indexOf(nonHostChars[i]);
      if (hec !== -1 && (hostEnd === -1 || hec < hostEnd))
        hostEnd = hec;
    }
    // if we still have not hit it, then the entire thing is a host.
    if (hostEnd === -1)
      hostEnd = rest.length;

    this.host = rest.slice(0, hostEnd);
    rest = rest.slice(hostEnd);

    // pull out port.
    this.parseHost();

    // we've indicated that there is a hostname,
    // so even if it's empty, it has to be present.
    this.hostname = this.hostname || '';

    // if hostname begins with [ and ends with ]
    // assume that it's an IPv6 address.
    var ipv6Hostname = this.hostname[0] === '[' &&
        this.hostname[this.hostname.length - 1] === ']';

    // validate a little.
    if (!ipv6Hostname) {
      var hostparts = this.hostname.split(/\./);
      for (var i = 0, l = hostparts.length; i < l; i++) {
        var part = hostparts[i];
        if (!part) continue;
        if (!part.match(hostnamePartPattern)) {
          var newpart = '';
          for (var j = 0, k = part.length; j < k; j++) {
            if (part.charCodeAt(j) > 127) {
              // we replace non-ASCII char with a temporary placeholder
              // we need this to make sure size of hostname is not
              // broken by replacing non-ASCII by nothing
              newpart += 'x';
            } else {
              newpart += part[j];
            }
          }
          // we test again with ASCII char only
          if (!newpart.match(hostnamePartPattern)) {
            var validParts = hostparts.slice(0, i);
            var notHost = hostparts.slice(i + 1);
            var bit = part.match(hostnamePartStart);
            if (bit) {
              validParts.push(bit[1]);
              notHost.unshift(bit[2]);
            }
            if (notHost.length) {
              rest = '/' + notHost.join('.') + rest;
            }
            this.hostname = validParts.join('.');
            break;
          }
        }
      }
    }

    if (this.hostname.length > hostnameMaxLen) {
      this.hostname = '';
    } else {
      // hostnames are always lower case.
      this.hostname = this.hostname.toLowerCase();
    }

    if (!ipv6Hostname) {
      // IDNA Support: Returns a puny coded representation of "domain".
      // It only converts the part of the domain name that
      // has non ASCII characters. I.e. it dosent matter if
      // you call it with a domain that already is in ASCII.
      var domainArray = this.hostname.split('.');
      var newOut = [];
      for (var i = 0; i < domainArray.length; ++i) {
        var s = domainArray[i];
        newOut.push(s.match(/[^A-Za-z0-9_-]/) ?
            'xn--' + punycode.encode(s) : s);
      }
      this.hostname = newOut.join('.');
    }

    var p = this.port ? ':' + this.port : '';
    var h = this.hostname || '';
    this.host = h + p;
    this.href += this.host;

    // strip [ and ] from the hostname
    // the host field still retains them, though
    if (ipv6Hostname) {
      this.hostname = this.hostname.substr(1, this.hostname.length - 2);
      if (rest[0] !== '/') {
        rest = '/' + rest;
      }
    }
  }

  // now rest is set to the post-host stuff.
  // chop off any delim chars.
  if (!unsafeProtocol[lowerProto]) {

    // First, make 100% sure that any "autoEscape" chars get
    // escaped, even if encodeURIComponent doesn't think they
    // need to be.
    for (var i = 0, l = autoEscape.length; i < l; i++) {
      var ae = autoEscape[i];
      var esc = encodeURIComponent(ae);
      if (esc === ae) {
        esc = escape(ae);
      }
      rest = rest.split(ae).join(esc);
    }
  }


  // chop off from the tail first.
  var hash = rest.indexOf('#');
  if (hash !== -1) {
    // got a fragment string.
    this.hash = rest.substr(hash);
    rest = rest.slice(0, hash);
  }
  var qm = rest.indexOf('?');
  if (qm !== -1) {
    this.search = rest.substr(qm);
    this.query = rest.substr(qm + 1);
    if (parseQueryString) {
      this.query = querystring.parse(this.query);
    }
    rest = rest.slice(0, qm);
  } else if (parseQueryString) {
    // no query string, but parseQueryString still requested
    this.search = '';
    this.query = {};
  }
  if (rest) this.pathname = rest;
  if (slashedProtocol[lowerProto] &&
      this.hostname && !this.pathname) {
    this.pathname = '/';
  }

  //to support http.request
  if (this.pathname || this.search) {
    var p = this.pathname || '';
    var s = this.search || '';
    this.path = p + s;
  }

  // finally, reconstruct the href based on what has been validated.
  this.href = this.format();
  return this;
};

// format a parsed object into a url string
function urlFormat(obj) {
  // ensure it's an object, and not a string url.
  // If it's an obj, this is a no-op.
  // this way, you can call url_format() on strings
  // to clean up potentially wonky urls.
  if (isString(obj)) obj = urlParse(obj);
  if (!(obj instanceof Url)) return Url.prototype.format.call(obj);
  return obj.format();
}

Url.prototype.format = function() {
  var auth = this.auth || '';
  if (auth) {
    auth = encodeURIComponent(auth);
    auth = auth.replace(/%3A/i, ':');
    auth += '@';
  }

  var protocol = this.protocol || '',
      pathname = this.pathname || '',
      hash = this.hash || '',
      host = false,
      query = '';

  if (this.host) {
    host = auth + this.host;
  } else if (this.hostname) {
    host = auth + (this.hostname.indexOf(':') === -1 ?
        this.hostname :
        '[' + this.hostname + ']');
    if (this.port) {
      host += ':' + this.port;
    }
  }

  if (this.query &&
      isObject(this.query) &&
      Object.keys(this.query).length) {
    query = querystring.stringify(this.query);
  }

  var search = this.search || (query && ('?' + query)) || '';

  if (protocol && protocol.substr(-1) !== ':') protocol += ':';

  // only the slashedProtocols get the //.  Not mailto:, xmpp:, etc.
  // unless they had them to begin with.
  if (this.slashes ||
      (!protocol || slashedProtocol[protocol]) && host !== false) {
    host = '//' + (host || '');
    if (pathname && pathname.charAt(0) !== '/') pathname = '/' + pathname;
  } else if (!host) {
    host = '';
  }

  if (hash && hash.charAt(0) !== '#') hash = '#' + hash;
  if (search && search.charAt(0) !== '?') search = '?' + search;

  pathname = pathname.replace(/[?#]/g, function(match) {
    return encodeURIComponent(match);
  });
  search = search.replace('#', '%23');

  return protocol + host + pathname + search + hash;
};

function urlResolve(source, relative) {
  return urlParse(source, false, true).resolve(relative);
}

Url.prototype.resolve = function(relative) {
  return this.resolveObject(urlParse(relative, false, true)).format();
};

function urlResolveObject(source, relative) {
  if (!source) return relative;
  return urlParse(source, false, true).resolveObject(relative);
}

Url.prototype.resolveObject = function(relative) {
  if (isString(relative)) {
    var rel = new Url();
    rel.parse(relative, false, true);
    relative = rel;
  }

  var result = new Url();
  Object.keys(this).forEach(function(k) {
    result[k] = this[k];
  }, this);

  // hash is always overridden, no matter what.
  // even href="" will remove it.
  result.hash = relative.hash;

  // if the relative url is empty, then there's nothing left to do here.
  if (relative.href === '') {
    result.href = result.format();
    return result;
  }

  // hrefs like //foo/bar always cut to the protocol.
  if (relative.slashes && !relative.protocol) {
    // take everything except the protocol from relative
    Object.keys(relative).forEach(function(k) {
      if (k !== 'protocol')
        result[k] = relative[k];
    });

    //urlParse appends trailing / to urls like http://www.example.com
    if (slashedProtocol[result.protocol] &&
        result.hostname && !result.pathname) {
      result.path = result.pathname = '/';
    }

    result.href = result.format();
    return result;
  }

  if (relative.protocol && relative.protocol !== result.protocol) {
    // if it's a known url protocol, then changing
    // the protocol does weird things
    // first, if it's not file:, then we MUST have a host,
    // and if there was a path
    // to begin with, then we MUST have a path.
    // if it is file:, then the host is dropped,
    // because that's known to be hostless.
    // anything else is assumed to be absolute.
    if (!slashedProtocol[relative.protocol]) {
      Object.keys(relative).forEach(function(k) {
        result[k] = relative[k];
      });
      result.href = result.format();
      return result;
    }

    result.protocol = relative.protocol;
    if (!relative.host && !hostlessProtocol[relative.protocol]) {
      var relPath = (relative.pathname || '').split('/');
      while (relPath.length && !(relative.host = relPath.shift()));
      if (!relative.host) relative.host = '';
      if (!relative.hostname) relative.hostname = '';
      if (relPath[0] !== '') relPath.unshift('');
      if (relPath.length < 2) relPath.unshift('');
      result.pathname = relPath.join('/');
    } else {
      result.pathname = relative.pathname;
    }
    result.search = relative.search;
    result.query = relative.query;
    result.host = relative.host || '';
    result.auth = relative.auth;
    result.hostname = relative.hostname || relative.host;
    result.port = relative.port;
    // to support http.request
    if (result.pathname || result.search) {
      var p = result.pathname || '';
      var s = result.search || '';
      result.path = p + s;
    }
    result.slashes = result.slashes || relative.slashes;
    result.href = result.format();
    return result;
  }

  var isSourceAbs = (result.pathname && result.pathname.charAt(0) === '/'),
      isRelAbs = (
          relative.host ||
          relative.pathname && relative.pathname.charAt(0) === '/'
      ),
      mustEndAbs = (isRelAbs || isSourceAbs ||
                    (result.host && relative.pathname)),
      removeAllDots = mustEndAbs,
      srcPath = result.pathname && result.pathname.split('/') || [],
      relPath = relative.pathname && relative.pathname.split('/') || [],
      psychotic = result.protocol && !slashedProtocol[result.protocol];

  // if the url is a non-slashed url, then relative
  // links like ../.. should be able
  // to crawl up to the hostname, as well.  This is strange.
  // result.protocol has already been set by now.
  // Later on, put the first path part into the host field.
  if (psychotic) {
    result.hostname = '';
    result.port = null;
    if (result.host) {
      if (srcPath[0] === '') srcPath[0] = result.host;
      else srcPath.unshift(result.host);
    }
    result.host = '';
    if (relative.protocol) {
      relative.hostname = null;
      relative.port = null;
      if (relative.host) {
        if (relPath[0] === '') relPath[0] = relative.host;
        else relPath.unshift(relative.host);
      }
      relative.host = null;
    }
    mustEndAbs = mustEndAbs && (relPath[0] === '' || srcPath[0] === '');
  }

  if (isRelAbs) {
    // it's absolute.
    result.host = (relative.host || relative.host === '') ?
                  relative.host : result.host;
    result.hostname = (relative.hostname || relative.hostname === '') ?
                      relative.hostname : result.hostname;
    result.search = relative.search;
    result.query = relative.query;
    srcPath = relPath;
    // fall through to the dot-handling below.
  } else if (relPath.length) {
    // it's relative
    // throw away the existing file, and take the new path instead.
    if (!srcPath) srcPath = [];
    srcPath.pop();
    srcPath = srcPath.concat(relPath);
    result.search = relative.search;
    result.query = relative.query;
  } else if (!isNullOrUndefined(relative.search)) {
    // just pull out the search.
    // like href='?foo'.
    // Put this after the other two cases because it simplifies the booleans
    if (psychotic) {
      result.hostname = result.host = srcPath.shift();
      //occationaly the auth can get stuck only in host
      //this especialy happens in cases like
      //url.resolveObject('mailto:local1@domain1', 'local2@domain2')
      var authInHost = result.host && result.host.indexOf('@') > 0 ?
                       result.host.split('@') : false;
      if (authInHost) {
        result.auth = authInHost.shift();
        result.host = result.hostname = authInHost.shift();
      }
    }
    result.search = relative.search;
    result.query = relative.query;
    //to support http.request
    if (!isNull(result.pathname) || !isNull(result.search)) {
      result.path = (result.pathname ? result.pathname : '') +
                    (result.search ? result.search : '');
    }
    result.href = result.format();
    return result;
  }

  if (!srcPath.length) {
    // no path at all.  easy.
    // we've already handled the other stuff above.
    result.pathname = null;
    //to support http.request
    if (result.search) {
      result.path = '/' + result.search;
    } else {
      result.path = null;
    }
    result.href = result.format();
    return result;
  }

  // if a url ENDs in . or .., then it must get a trailing slash.
  // however, if it ends in anything else non-slashy,
  // then it must NOT get a trailing slash.
  var last = srcPath.slice(-1)[0];
  var hasTrailingSlash = (
      (result.host || relative.host) && (last === '.' || last === '..') ||
      last === '');

  // strip single dots, resolve double dots to parent dir
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = srcPath.length; i >= 0; i--) {
    last = srcPath[i];
    if (last == '.') {
      srcPath.splice(i, 1);
    } else if (last === '..') {
      srcPath.splice(i, 1);
      up++;
    } else if (up) {
      srcPath.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (!mustEndAbs && !removeAllDots) {
    for (; up--; up) {
      srcPath.unshift('..');
    }
  }

  if (mustEndAbs && srcPath[0] !== '' &&
      (!srcPath[0] || srcPath[0].charAt(0) !== '/')) {
    srcPath.unshift('');
  }

  if (hasTrailingSlash && (srcPath.join('/').substr(-1) !== '/')) {
    srcPath.push('');
  }

  var isAbsolute = srcPath[0] === '' ||
      (srcPath[0] && srcPath[0].charAt(0) === '/');

  // put the host back
  if (psychotic) {
    result.hostname = result.host = isAbsolute ? '' :
                                    srcPath.length ? srcPath.shift() : '';
    //occationaly the auth can get stuck only in host
    //this especialy happens in cases like
    //url.resolveObject('mailto:local1@domain1', 'local2@domain2')
    var authInHost = result.host && result.host.indexOf('@') > 0 ?
                     result.host.split('@') : false;
    if (authInHost) {
      result.auth = authInHost.shift();
      result.host = result.hostname = authInHost.shift();
    }
  }

  mustEndAbs = mustEndAbs || (result.host && srcPath.length);

  if (mustEndAbs && !isAbsolute) {
    srcPath.unshift('');
  }

  if (!srcPath.length) {
    result.pathname = null;
    result.path = null;
  } else {
    result.pathname = srcPath.join('/');
  }

  //to support request.http
  if (!isNull(result.pathname) || !isNull(result.search)) {
    result.path = (result.pathname ? result.pathname : '') +
                  (result.search ? result.search : '');
  }
  result.auth = relative.auth || result.auth;
  result.slashes = result.slashes || relative.slashes;
  result.href = result.format();
  return result;
};

Url.prototype.parseHost = function() {
  var host = this.host;
  var port = portPattern.exec(host);
  if (port) {
    port = port[0];
    if (port !== ':') {
      this.port = port.substr(1);
    }
    host = host.substr(0, host.length - port.length);
  }
  if (host) this.hostname = host;
};

function isString(arg) {
  return typeof arg === "string";
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isNull(arg) {
  return arg === null;
}
function isNullOrUndefined(arg) {
  return  arg == null;
}

},{"punycode":1,"querystring":4}],6:[function(require,module,exports){
/*
 * quantize.js Copyright 2008 Nick Rabinowitz
 * Ported to node.js by Olivier Lesnicki
 * Licensed under the MIT license: http://www.opensource.org/licenses/mit-license.php
 */

// fill out a couple protovis dependencies
/*
 * Block below copied from Protovis: http://mbostock.github.com/protovis/
 * Copyright 2010 Stanford Visualization Group
 * Licensed under the BSD License: http://www.opensource.org/licenses/bsd-license.php
 */
if (!pv) {
    var pv = {
        map: function(array, f) {
            var o = {};
            return f ? array.map(function(d, i) {
                o.index = i;
                return f.call(o, d);
            }) : array.slice();
        },
        naturalOrder: function(a, b) {
            return (a < b) ? -1 : ((a > b) ? 1 : 0);
        },
        sum: function(array, f) {
            var o = {};
            return array.reduce(f ? function(p, d, i) {
                o.index = i;
                return p + f.call(o, d);
            } : function(p, d) {
                return p + d;
            }, 0);
        },
        max: function(array, f) {
            return Math.max.apply(null, f ? pv.map(array, f) : array);
        }
    }
}

/**
 * Basic Javascript port of the MMCQ (modified median cut quantization)
 * algorithm from the Leptonica library (http://www.leptonica.com/).
 * Returns a color map you can use to map original pixels to the reduced
 * palette. Still a work in progress.
 * 
 * @author Nick Rabinowitz
 * @example
 
// array of pixels as [R,G,B] arrays
var myPixels = [[190,197,190], [202,204,200], [207,214,210], [211,214,211], [205,207,207]
                // etc
                ];
var maxColors = 4;
 
var cmap = MMCQ.quantize(myPixels, maxColors);
var newPalette = cmap.palette();
var newPixels = myPixels.map(function(p) { 
    return cmap.map(p); 
});
 
 */
var MMCQ = (function() {
    // private constants
    var sigbits = 5,
        rshift = 8 - sigbits,
        maxIterations = 1000,
        fractByPopulations = 0.75;

    // get reduced-space color index for a pixel

    function getColorIndex(r, g, b) {
        return (r << (2 * sigbits)) + (g << sigbits) + b;
    }

    // Simple priority queue

    function PQueue(comparator) {
        var contents = [],
            sorted = false;

        function sort() {
            contents.sort(comparator);
            sorted = true;
        }

        return {
            push: function(o) {
                contents.push(o);
                sorted = false;
            },
            peek: function(index) {
                if (!sorted) sort();
                if (index === undefined) index = contents.length - 1;
                return contents[index];
            },
            pop: function() {
                if (!sorted) sort();
                return contents.pop();
            },
            size: function() {
                return contents.length;
            },
            map: function(f) {
                return contents.map(f);
            },
            debug: function() {
                if (!sorted) sort();
                return contents;
            }
        };
    }

    // 3d color space box

    function VBox(r1, r2, g1, g2, b1, b2, histo) {
        var vbox = this;
        vbox.r1 = r1;
        vbox.r2 = r2;
        vbox.g1 = g1;
        vbox.g2 = g2;
        vbox.b1 = b1;
        vbox.b2 = b2;
        vbox.histo = histo;
    }
    VBox.prototype = {
        volume: function(force) {
            var vbox = this;
            if (!vbox._volume || force) {
                vbox._volume = ((vbox.r2 - vbox.r1 + 1) * (vbox.g2 - vbox.g1 + 1) * (vbox.b2 - vbox.b1 + 1));
            }
            return vbox._volume;
        },
        count: function(force) {
            var vbox = this,
                histo = vbox.histo;
            if (!vbox._count_set || force) {
                var npix = 0,
                    i, j, k;
                for (i = vbox.r1; i <= vbox.r2; i++) {
                    for (j = vbox.g1; j <= vbox.g2; j++) {
                        for (k = vbox.b1; k <= vbox.b2; k++) {
                            index = getColorIndex(i, j, k);
                            npix += (histo[index] || 0);
                        }
                    }
                }
                vbox._count = npix;
                vbox._count_set = true;
            }
            return vbox._count;
        },
        copy: function() {
            var vbox = this;
            return new VBox(vbox.r1, vbox.r2, vbox.g1, vbox.g2, vbox.b1, vbox.b2, vbox.histo);
        },
        avg: function(force) {
            var vbox = this,
                histo = vbox.histo;
            if (!vbox._avg || force) {
                var ntot = 0,
                    mult = 1 << (8 - sigbits),
                    rsum = 0,
                    gsum = 0,
                    bsum = 0,
                    hval,
                    i, j, k, histoindex;
                for (i = vbox.r1; i <= vbox.r2; i++) {
                    for (j = vbox.g1; j <= vbox.g2; j++) {
                        for (k = vbox.b1; k <= vbox.b2; k++) {
                            histoindex = getColorIndex(i, j, k);
                            hval = histo[histoindex] || 0;
                            ntot += hval;
                            rsum += (hval * (i + 0.5) * mult);
                            gsum += (hval * (j + 0.5) * mult);
                            bsum += (hval * (k + 0.5) * mult);
                        }
                    }
                }
                if (ntot) {
                    vbox._avg = [~~(rsum / ntot), ~~ (gsum / ntot), ~~ (bsum / ntot)];
                } else {
                    //console.log('empty box');
                    vbox._avg = [~~(mult * (vbox.r1 + vbox.r2 + 1) / 2), ~~ (mult * (vbox.g1 + vbox.g2 + 1) / 2), ~~ (mult * (vbox.b1 + vbox.b2 + 1) / 2)];
                }
            }
            return vbox._avg;
        },
        contains: function(pixel) {
            var vbox = this,
                rval = pixel[0] >> rshift;
            gval = pixel[1] >> rshift;
            bval = pixel[2] >> rshift;
            return (rval >= vbox.r1 && rval <= vbox.r2 &&
                gval >= vbox.g1 && gval <= vbox.g2 &&
                bval >= vbox.b1 && bval <= vbox.b2);
        }
    };

    // Color map

    function CMap() {
        this.vboxes = new PQueue(function(a, b) {
            return pv.naturalOrder(
                a.vbox.count() * a.vbox.volume(),
                b.vbox.count() * b.vbox.volume()
            )
        });;
    }
    CMap.prototype = {
        push: function(vbox) {
            this.vboxes.push({
                vbox: vbox,
                color: vbox.avg()
            });
        },
        palette: function() {
            return this.vboxes.map(function(vb) {
                return vb.color
            });
        },
        size: function() {
            return this.vboxes.size();
        },
        map: function(color) {
            var vboxes = this.vboxes;
            for (var i = 0; i < vboxes.size(); i++) {
                if (vboxes.peek(i).vbox.contains(color)) {
                    return vboxes.peek(i).color;
                }
            }
            return this.nearest(color);
        },
        nearest: function(color) {
            var vboxes = this.vboxes,
                d1, d2, pColor;
            for (var i = 0; i < vboxes.size(); i++) {
                d2 = Math.sqrt(
                    Math.pow(color[0] - vboxes.peek(i).color[0], 2) +
                    Math.pow(color[1] - vboxes.peek(i).color[1], 2) +
                    Math.pow(color[2] - vboxes.peek(i).color[2], 2)
                );
                if (d2 < d1 || d1 === undefined) {
                    d1 = d2;
                    pColor = vboxes.peek(i).color;
                }
            }
            return pColor;
        },
        forcebw: function() {
            // XXX: won't  work yet
            var vboxes = this.vboxes;
            vboxes.sort(function(a, b) {
                return pv.naturalOrder(pv.sum(a.color), pv.sum(b.color))
            });

            // force darkest color to black if everything < 5
            var lowest = vboxes[0].color;
            if (lowest[0] < 5 && lowest[1] < 5 && lowest[2] < 5)
                vboxes[0].color = [0, 0, 0];

            // force lightest color to white if everything > 251
            var idx = vboxes.length - 1,
                highest = vboxes[idx].color;
            if (highest[0] > 251 && highest[1] > 251 && highest[2] > 251)
                vboxes[idx].color = [255, 255, 255];
        }
    };

    // histo (1-d array, giving the number of pixels in
    // each quantized region of color space), or null on error

    function getHisto(pixels) {
        var histosize = 1 << (3 * sigbits),
            histo = new Array(histosize),
            index, rval, gval, bval;
        pixels.forEach(function(pixel) {
            rval = pixel[0] >> rshift;
            gval = pixel[1] >> rshift;
            bval = pixel[2] >> rshift;
            index = getColorIndex(rval, gval, bval);
            histo[index] = (histo[index] || 0) + 1;
        });
        return histo;
    }

    function vboxFromPixels(pixels, histo) {
        var rmin = 1000000,
            rmax = 0,
            gmin = 1000000,
            gmax = 0,
            bmin = 1000000,
            bmax = 0,
            rval, gval, bval;
        // find min/max
        pixels.forEach(function(pixel) {
            rval = pixel[0] >> rshift;
            gval = pixel[1] >> rshift;
            bval = pixel[2] >> rshift;
            if (rval < rmin) rmin = rval;
            else if (rval > rmax) rmax = rval;
            if (gval < gmin) gmin = gval;
            else if (gval > gmax) gmax = gval;
            if (bval < bmin) bmin = bval;
            else if (bval > bmax) bmax = bval;
        });
        return new VBox(rmin, rmax, gmin, gmax, bmin, bmax, histo);
    }

    function medianCutApply(histo, vbox) {
        if (!vbox.count()) return;

        var rw = vbox.r2 - vbox.r1 + 1,
            gw = vbox.g2 - vbox.g1 + 1,
            bw = vbox.b2 - vbox.b1 + 1,
            maxw = pv.max([rw, gw, bw]);
        // only one pixel, no split
        if (vbox.count() == 1) {
            return [vbox.copy()]
        }
        /* Find the partial sum arrays along the selected axis. */
        var total = 0,
            partialsum = [],
            lookaheadsum = [],
            i, j, k, sum, index;
        if (maxw == rw) {
            for (i = vbox.r1; i <= vbox.r2; i++) {
                sum = 0;
                for (j = vbox.g1; j <= vbox.g2; j++) {
                    for (k = vbox.b1; k <= vbox.b2; k++) {
                        index = getColorIndex(i, j, k);
                        sum += (histo[index] || 0);
                    }
                }
                total += sum;
                partialsum[i] = total;
            }
        } else if (maxw == gw) {
            for (i = vbox.g1; i <= vbox.g2; i++) {
                sum = 0;
                for (j = vbox.r1; j <= vbox.r2; j++) {
                    for (k = vbox.b1; k <= vbox.b2; k++) {
                        index = getColorIndex(j, i, k);
                        sum += (histo[index] || 0);
                    }
                }
                total += sum;
                partialsum[i] = total;
            }
        } else { /* maxw == bw */
            for (i = vbox.b1; i <= vbox.b2; i++) {
                sum = 0;
                for (j = vbox.r1; j <= vbox.r2; j++) {
                    for (k = vbox.g1; k <= vbox.g2; k++) {
                        index = getColorIndex(j, k, i);
                        sum += (histo[index] || 0);
                    }
                }
                total += sum;
                partialsum[i] = total;
            }
        }
        partialsum.forEach(function(d, i) {
            lookaheadsum[i] = total - d
        });

        function doCut(color) {
            var dim1 = color + '1',
                dim2 = color + '2',
                left, right, vbox1, vbox2, d2, count2 = 0;
            for (i = vbox[dim1]; i <= vbox[dim2]; i++) {
                if (partialsum[i] > total / 2) {
                    vbox1 = vbox.copy();
                    vbox2 = vbox.copy();
                    left = i - vbox[dim1];
                    right = vbox[dim2] - i;
                    if (left <= right)
                        d2 = Math.min(vbox[dim2] - 1, ~~ (i + right / 2));
                    else d2 = Math.max(vbox[dim1], ~~ (i - 1 - left / 2));
                    // avoid 0-count boxes
                    while (!partialsum[d2]) d2++;
                    count2 = lookaheadsum[d2];
                    while (!count2 && partialsum[d2 - 1]) count2 = lookaheadsum[--d2];
                    // set dimensions
                    vbox1[dim2] = d2;
                    vbox2[dim1] = vbox1[dim2] + 1;
                    // console.log('vbox counts:', vbox.count(), vbox1.count(), vbox2.count());
                    return [vbox1, vbox2];
                }
            }

        }
        // determine the cut planes
        return maxw == rw ? doCut('r') :
            maxw == gw ? doCut('g') :
            doCut('b');
    }

    function quantize(pixels, maxcolors) {
        // short-circuit
        if (!pixels.length || maxcolors < 2 || maxcolors > 256) {
            // console.log('wrong number of maxcolors');
            return false;
        }

        // XXX: check color content and convert to grayscale if insufficient

        var histo = getHisto(pixels),
            histosize = 1 << (3 * sigbits);

        // check that we aren't below maxcolors already
        var nColors = 0;
        histo.forEach(function() {
            nColors++
        });
        if (nColors <= maxcolors) {
            // XXX: generate the new colors from the histo and return
        }

        // get the beginning vbox from the colors
        var vbox = vboxFromPixels(pixels, histo),
            pq = new PQueue(function(a, b) {
                return pv.naturalOrder(a.count(), b.count())
            });
        pq.push(vbox);

        // inner function to do the iteration

        function iter(lh, target) {
            var ncolors = 1,
                niters = 0,
                vbox;
            while (niters < maxIterations) {
                vbox = lh.pop();
                if (!vbox.count()) { /* just put it back */
                    lh.push(vbox);
                    niters++;
                    continue;
                }
                // do the cut
                var vboxes = medianCutApply(histo, vbox),
                    vbox1 = vboxes[0],
                    vbox2 = vboxes[1];

                if (!vbox1) {
                    // console.log("vbox1 not defined; shouldn't happen!");
                    return;
                }
                lh.push(vbox1);
                if (vbox2) { /* vbox2 can be null */
                    lh.push(vbox2);
                    ncolors++;
                }
                if (ncolors >= target) return;
                if (niters++ > maxIterations) {
                    // console.log("infinite loop; perhaps too few pixels!");
                    return;
                }
            }
        }

        // first set of colors, sorted by population
        iter(pq, fractByPopulations * maxcolors);
        // console.log(pq.size(), pq.debug().length, pq.debug().slice());

        // Re-sort by the product of pixel occupancy times the size in color space.
        var pq2 = new PQueue(function(a, b) {
            return pv.naturalOrder(a.count() * a.volume(), b.count() * b.volume())
        });
        while (pq.size()) {
            pq2.push(pq.pop());
        }

        // next set - generate the median cuts using the (npix * vol) sorting.
        iter(pq2, maxcolors - pq2.size());

        // calculate the actual colors
        var cmap = new CMap();
        while (pq2.size()) {
            cmap.push(pq2.pop());
        }

        return cmap;
    }

    return {
        quantize: quantize
    }
})();

module.exports = MMCQ.quantize

},{}],7:[function(require,module,exports){
var Vibrant;

Vibrant = require('./vibrant');

Vibrant.DefaultOpts.Image = require('./image/browser');

module.exports = Vibrant;


},{"./image/browser":13,"./vibrant":26}],8:[function(require,module,exports){
var Vibrant;

window.Vibrant = Vibrant = require('./browser');


},{"./browser":7}],9:[function(require,module,exports){
module.exports = function(r, g, b, a) {
  return a >= 125 && !(r > 250 && g > 250 && b > 250);
};


},{}],10:[function(require,module,exports){
module.exports.Default = require('./default');


},{"./default":9}],11:[function(require,module,exports){
var DefaultGenerator, DefaultOpts, Generator, Swatch, util,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  slice = [].slice;

Swatch = require('../swatch');

util = require('../util');

Generator = require('./index');

DefaultOpts = {
  targetDarkLuma: 0.26,
  maxDarkLuma: 0.45,
  minLightLuma: 0.55,
  targetLightLuma: 0.74,
  minNormalLuma: 0.3,
  targetNormalLuma: 0.5,
  maxNormalLuma: 0.7,
  targetMutesSaturation: 0.3,
  maxMutesSaturation: 0.4,
  targetVibrantSaturation: 1.0,
  minVibrantSaturation: 0.35,
  weightSaturation: 3,
  weightLuma: 6,
  weightPopulation: 1
};

module.exports = DefaultGenerator = (function(superClass) {
  extend(DefaultGenerator, superClass);

  DefaultGenerator.prototype.HighestPopulation = 0;

  function DefaultGenerator(opts) {
    this.opts = util.defaults(opts, DefaultOpts);
    this.VibrantSwatch = null;
    this.LightVibrantSwatch = null;
    this.DarkVibrantSwatch = null;
    this.MutedSwatch = null;
    this.LightMutedSwatch = null;
    this.DarkMutedSwatch = null;
  }

  DefaultGenerator.prototype.generate = function(swatches) {
    this.swatches = swatches;
    this.maxPopulation = this.findMaxPopulation;
    this.generateVarationColors();
    return this.generateEmptySwatches();
  };

  DefaultGenerator.prototype.getVibrantSwatch = function() {
    return this.VibrantSwatch;
  };

  DefaultGenerator.prototype.getLightVibrantSwatch = function() {
    return this.LightVibrantSwatch;
  };

  DefaultGenerator.prototype.getDarkVibrantSwatch = function() {
    return this.DarkVibrantSwatch;
  };

  DefaultGenerator.prototype.getMutedSwatch = function() {
    return this.MutedSwatch;
  };

  DefaultGenerator.prototype.getLightMutedSwatch = function() {
    return this.LightMutedSwatch;
  };

  DefaultGenerator.prototype.getDarkMutedSwatch = function() {
    return this.DarkMutedSwatch;
  };

  DefaultGenerator.prototype.generateVarationColors = function() {
    this.VibrantSwatch = this.findColorVariation(this.opts.targetNormalLuma, this.opts.minNormalLuma, this.opts.maxNormalLuma, this.opts.targetVibrantSaturation, this.opts.minVibrantSaturation, 1);
    this.LightVibrantSwatch = this.findColorVariation(this.opts.targetLightLuma, this.opts.minLightLuma, 1, this.opts.targetVibrantSaturation, this.opts.minVibrantSaturation, 1);
    this.DarkVibrantSwatch = this.findColorVariation(this.opts.targetDarkLuma, 0, this.opts.maxDarkLuma, this.opts.targetVibrantSaturation, this.opts.minVibrantSaturation, 1);
    this.MutedSwatch = this.findColorVariation(this.opts.targetNormalLuma, this.opts.minNormalLuma, this.opts.maxNormalLuma, this.opts.targetMutesSaturation, 0, this.opts.maxMutesSaturation);
    this.LightMutedSwatch = this.findColorVariation(this.opts.targetLightLuma, this.opts.minLightLuma, 1, this.opts.targetMutesSaturation, 0, this.opts.maxMutesSaturation);
    return this.DarkMutedSwatch = this.findColorVariation(this.opts.targetDarkLuma, 0, this.opts.maxDarkLuma, this.opts.targetMutesSaturation, 0, this.opts.maxMutesSaturation);
  };

  DefaultGenerator.prototype.generateEmptySwatches = function() {
    var hsl;
    if (this.VibrantSwatch === null) {
      if (this.DarkVibrantSwatch !== null) {
        hsl = this.DarkVibrantSwatch.getHsl();
        hsl[2] = this.opts.targetNormalLuma;
        this.VibrantSwatch = new Swatch(util.hslToRgb(hsl[0], hsl[1], hsl[2]), 0);
      }
    }
    if (this.DarkVibrantSwatch === null) {
      if (this.VibrantSwatch !== null) {
        hsl = this.VibrantSwatch.getHsl();
        hsl[2] = this.opts.targetDarkLuma;
        return this.DarkVibrantSwatch = new Swatch(util.hslToRgb(hsl[0], hsl[1], hsl[2]), 0);
      }
    }
  };

  DefaultGenerator.prototype.findMaxPopulation = function() {
    var j, len, population, ref, swatch;
    population = 0;
    ref = this.swatches;
    for (j = 0, len = ref.length; j < len; j++) {
      swatch = ref[j];
      population = Math.max(population, swatch.getPopulation());
    }
    return population;
  };

  DefaultGenerator.prototype.findColorVariation = function(targetLuma, minLuma, maxLuma, targetSaturation, minSaturation, maxSaturation) {
    var j, len, luma, max, maxValue, ref, sat, swatch, value;
    max = null;
    maxValue = 0;
    ref = this.swatches;
    for (j = 0, len = ref.length; j < len; j++) {
      swatch = ref[j];
      sat = swatch.getHsl()[1];
      luma = swatch.getHsl()[2];
      if (sat >= minSaturation && sat <= maxSaturation && luma >= minLuma && luma <= maxLuma && !this.isAlreadySelected(swatch)) {
        value = this.createComparisonValue(sat, targetSaturation, luma, targetLuma, swatch.getPopulation(), this.HighestPopulation);
        if (max === null || value > maxValue) {
          max = swatch;
          maxValue = value;
        }
      }
    }
    return max;
  };

  DefaultGenerator.prototype.createComparisonValue = function(saturation, targetSaturation, luma, targetLuma, population, maxPopulation) {
    return this.weightedMean(this.invertDiff(saturation, targetSaturation), this.opts.weightSaturation, this.invertDiff(luma, targetLuma), this.opts.weightLuma, population / maxPopulation, this.opts.weightPopulation);
  };

  DefaultGenerator.prototype.invertDiff = function(value, targetValue) {
    return 1 - Math.abs(value - targetValue);
  };

  DefaultGenerator.prototype.weightedMean = function() {
    var i, sum, sumWeight, value, values, weight;
    values = 1 <= arguments.length ? slice.call(arguments, 0) : [];
    sum = 0;
    sumWeight = 0;
    i = 0;
    while (i < values.length) {
      value = values[i];
      weight = values[i + 1];
      sum += value * weight;
      sumWeight += weight;
      i += 2;
    }
    return sum / sumWeight;
  };

  DefaultGenerator.prototype.isAlreadySelected = function(swatch) {
    return this.VibrantSwatch === swatch || this.DarkVibrantSwatch === swatch || this.LightVibrantSwatch === swatch || this.MutedSwatch === swatch || this.DarkMutedSwatch === swatch || this.LightMutedSwatch === swatch;
  };

  return DefaultGenerator;

})(Generator);


},{"../swatch":24,"../util":25,"./index":12}],12:[function(require,module,exports){
var Generator;

module.exports = Generator = (function() {
  function Generator() {}

  Generator.prototype.generate = function(swatches) {};

  Generator.prototype.getVibrantSwatch = function() {};

  Generator.prototype.getLightVibrantSwatch = function() {};

  Generator.prototype.getDarkVibrantSwatch = function() {};

  Generator.prototype.getMutedSwatch = function() {};

  Generator.prototype.getLightMutedSwatch = function() {};

  Generator.prototype.getDarkMutedSwatch = function() {};

  return Generator;

})();

module.exports.Default = require('./default');


},{"./default":11}],13:[function(require,module,exports){
var BrowserImage, Image, Url, isRelativeUrl, isSameOrigin,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

Image = require('./index');

Url = require('url');

isRelativeUrl = function(url) {
  var u;
  u = Url.parse(url);
  return u.protocol === null && u.host === null && u.port === null;
};

isSameOrigin = function(a, b) {
  var ua, ub;
  ua = Url.parse(a);
  ub = Url.parse(b);
  return ua.protocol === ub.protocol && ua.hostname === ub.hostname && ua.port === ub.port;
};

module.exports = BrowserImage = (function(superClass) {
  extend(BrowserImage, superClass);

  function BrowserImage(path, cb) {
    this.img = document.createElement('img');
    if (!isRelativeUrl(path) && !isSameOrigin(window.location.href, path)) {
      this.img.crossOrigin = 'anonymous';
    }
    this.img.src = path;
    this.img.onload = (function(_this) {
      return function() {
        _this._initCanvas();
        return typeof cb === "function" ? cb(null, _this) : void 0;
      };
    })(this);
    this.img.onerror = (function(_this) {
      return function(e) {
        var err;
        err = new Error("Fail to load image: " + path);
        err.raw = e;
        return typeof cb === "function" ? cb(err) : void 0;
      };
    })(this);
  }

  BrowserImage.prototype._initCanvas = function() {
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d');
    document.body.appendChild(this.canvas);
    this.width = this.canvas.width = this.img.width;
    this.height = this.canvas.height = this.img.height;
    return this.context.drawImage(this.img, 0, 0, this.width, this.height);
  };

  BrowserImage.prototype.clear = function() {
    return this.context.clearRect(0, 0, this.width, this.height);
  };

  BrowserImage.prototype.getWidth = function() {
    return this.width;
  };

  BrowserImage.prototype.getHeight = function() {
    return this.height;
  };

  BrowserImage.prototype.resize = function(w, h, r) {
    this.width = this.canvas.width = w;
    this.height = this.canvas.height = h;
    this.context.scale(r, r);
    return this.context.drawImage(this.img, 0, 0);
  };

  BrowserImage.prototype.update = function(imageData) {
    return this.context.putImageData(imageData, 0, 0);
  };

  BrowserImage.prototype.getPixelCount = function() {
    return this.width * this.height;
  };

  BrowserImage.prototype.getImageData = function() {
    return this.context.getImageData(0, 0, this.width, this.height);
  };

  BrowserImage.prototype.removeCanvas = function() {
    return this.canvas.parentNode.removeChild(this.canvas);
  };

  return BrowserImage;

})(Image);


},{"./index":14,"url":5}],14:[function(require,module,exports){
var Image;

module.exports = Image = (function() {
  function Image() {}

  Image.prototype.clear = function() {};

  Image.prototype.update = function(imageData) {};

  Image.prototype.getWidth = function() {};

  Image.prototype.getHeight = function() {};

  Image.prototype.scaleDown = function(opts) {
    var height, maxSide, ratio, width;
    width = this.getWidth();
    height = this.getHeight();
    ratio = 1;
    if (opts.maxDimension != null) {
      maxSide = Math.max(width, height);
      if (maxSide > opts.maxDimension) {
        ratio = opts.maxDimension / maxSide;
      }
    } else {
      ratio = 1 / opts.quality;
    }
    if (ratio < 1) {
      return this.resize(width * ratio, height * ratio, ratio);
    }
  };

  Image.prototype.resize = function(w, h, r) {};

  Image.prototype.getPixelCount = function() {};

  Image.prototype.getImageData = function() {};

  Image.prototype.removeCanvas = function() {};

  return Image;

})();


},{}],15:[function(require,module,exports){
var BaselineQuantizer, Quantizer, Swatch, quantize,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

Swatch = require('../swatch');

Quantizer = require('./index');

quantize = require('quantize');

module.exports = BaselineQuantizer = (function(superClass) {
  extend(BaselineQuantizer, superClass);

  function BaselineQuantizer() {
    return BaselineQuantizer.__super__.constructor.apply(this, arguments);
  }

  BaselineQuantizer.prototype.initialize = function(pixels, opts) {
    var a, allPixels, b, cmap, g, i, offset, pixelCount, r;
    this.opts = opts;
    pixelCount = pixels.length / 4;
    allPixels = [];
    i = 0;
    while (i < pixelCount) {
      offset = i * 4;
      r = pixels[offset + 0];
      g = pixels[offset + 1];
      b = pixels[offset + 2];
      a = pixels[offset + 3];
      if (a >= 125) {
        if (!(r > 250 && g > 250 && b > 250)) {
          allPixels.push([r, g, b]);
        }
      }
      i = i + this.opts.quality;
    }
    cmap = quantize(allPixels, this.opts.colorCount);
    return this.swatches = cmap.vboxes.map((function(_this) {
      return function(vbox) {
        return new Swatch(vbox.color, vbox.vbox.count());
      };
    })(this));
  };

  BaselineQuantizer.prototype.getQuantizedColors = function() {
    return this.swatches;
  };

  return BaselineQuantizer;

})(Quantizer);


},{"../swatch":24,"./index":21,"quantize":6}],16:[function(require,module,exports){
var ColorCut, ColorCutQuantizer, Quantizer, Swatch,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

Swatch = require('../swatch');

Quantizer = require('./index');

ColorCut = require('./impl/color-cut');

module.exports = ColorCutQuantizer = (function(superClass) {
  extend(ColorCutQuantizer, superClass);

  function ColorCutQuantizer() {
    return ColorCutQuantizer.__super__.constructor.apply(this, arguments);
  }

  ColorCutQuantizer.prototype.initialize = function(pixels, opts) {
    var buf, buf8, data;
    this.opts = opts;
    buf = new ArrayBuffer(pixels.length);
    buf8 = new Uint8ClampedArray(buf);
    data = new Uint32Array(buf);
    buf8.set(pixels);
    return this.quantizer = new ColorCut(data, this.opts);
  };

  ColorCutQuantizer.prototype.getQuantizedColors = function() {
    return this.quantizer.getQuantizedColors();
  };

  return ColorCutQuantizer;

})(Quantizer);


},{"../swatch":24,"./impl/color-cut":17,"./index":21}],17:[function(require,module,exports){
var ABGRColor, COMPONENT_BLUE, COMPONENT_GREEN, COMPONENT_RED, Color, ColorCutQuantizer, QUANTIZE_WORD_MASK, QUANTIZE_WORD_WIDTH, RGBAColor, Swatch, Vbox, approximateToRgb888, isLittleEndian, modifySignificantOctet, modifyWordWidth, quantizeFromRgb888, quantizedBlue, quantizedGreen, quantizedRed, sort;

Swatch = require('../../swatch');

sort = function(arr, lower, upper) {
  var partition, pivot, swap;
  swap = function(a, b) {
    var t;
    t = arr[a];
    arr[a] = arr[b];
    return arr[b] = t;
  };
  partition = function(pivot, left, right) {
    var index, j, ref, ref1, v, value;
    index = left;
    value = arr[pivot];
    swap(pivot, right);
    for (v = j = ref = left, ref1 = right - 1; ref <= ref1 ? j <= ref1 : j >= ref1; v = ref <= ref1 ? ++j : --j) {
      if (arr[v] > value) {
        swap(v, index);
        index++;
      }
    }
    swap(right, index);
    return index;
  };
  if (lower < upper) {
    pivot = lower + Math.ceil((upper - lower) / 2);
    pivot = partition(pivot, lower, upper);
    sort(arr, lower, pivot - 1);
    return sort(arr, pivot + 1, upper);
  }
};

COMPONENT_RED = -3;

COMPONENT_GREEN = -2;

COMPONENT_BLUE = -1;

QUANTIZE_WORD_WIDTH = 5;

QUANTIZE_WORD_MASK = (1 << QUANTIZE_WORD_WIDTH) - 1;

RGBAColor = {
  red: function(c) {
    return c >> 24;
  },
  green: function(c) {
    return c << 8 >> 24;
  },
  blue: function(c) {
    return c << 16 >> 24;
  },
  alpha: function(c) {
    return c << 24 >> 24;
  }
};

ABGRColor = {
  red: function(c) {
    return c << 24 >> 24;
  },
  green: function(c) {
    return c << 16 >> 24;
  },
  blue: function(c) {
    return c << 8 >> 24;
  },
  alpha: function(c) {
    return c >> 24;
  }
};

isLittleEndian = function() {
  var a, b, c;
  a = new ArrayBuffer(4);
  b = new Uint8Array(a);
  c = new Uint32Array(a);
  b[0] = 0xa1;
  b[1] = 0xb2;
  b[2] = 0xc3;
  b[3] = 0xd4;
  if (c[0] === 0xd4c3b2a1) {
    return true;
  }
  if (c[0] === 0xa1b2c3d4) {
    return false;
  }
  throw new Error("Failed to determin endianness");
};

Color = isLittleEndian() ? ABGRColor : RGBAColor;

modifyWordWidth = function(value, current, target) {
  var newValue;
  newValue = 0;
  if (target > current) {
    newValue = value << (target - current);
  } else {
    newValue = value >> (current - target);
  }
  return newValue & ((1 << target) - 1);
};

modifySignificantOctet = function(a, dimension, lower, upper) {
  var color, i, j, k, ref, ref1, ref2, ref3;
  switch (dimension) {
    case COMPONENT_RED:
      break;
    case COMPONENT_GREEN:
      for (i = j = ref = lower, ref1 = upper; ref <= ref1 ? j <= ref1 : j >= ref1; i = ref <= ref1 ? ++j : --j) {
        color = a[i];
        a[i] = quantizedGreen(color) << (QUANTIZE_WORD_WIDTH + QUANTIZE_WORD_WIDTH) | quantizedRed(color) << QUANTIZE_WORD_WIDTH | quantizedBlue(color);
      }
      break;
    case COMPONENT_BLUE:
      for (i = k = ref2 = lower, ref3 = upper; ref2 <= ref3 ? k <= ref3 : k >= ref3; i = ref2 <= ref3 ? ++k : --k) {
        color = a[i];
        a[i] = quantizedBlue(color) << (QUANTIZE_WORD_WIDTH + QUANTIZE_WORD_WIDTH) | quantizedGreen(color) << QUANTIZE_WORD_WIDTH | quantizedRed(color);
      }
      break;
  }
};

quantizeFromRgb888 = function(color) {
  var b, g, r;
  r = modifyWordWidth(Color.red(color), 8, QUANTIZE_WORD_WIDTH);
  g = modifyWordWidth(Color.green(color), 8, QUANTIZE_WORD_WIDTH);
  b = modifyWordWidth(Color.blue(color), 8, QUANTIZE_WORD_WIDTH);
  return r << (QUANTIZE_WORD_WIDTH + QUANTIZE_WORD_WIDTH) | g << QUANTIZE_WORD_WIDTH | b;
};

approximateToRgb888 = function(r, g, b) {
  var color;
  if (!((g != null) && (b != null))) {
    color = r;
    r = quantizedRed(color);
    g = quantizedGreen(color);
    b = quantizedBlue(color);
  }
  return [modifyWordWidth(r, QUANTIZE_WORD_WIDTH, 8), modifyWordWidth(g, QUANTIZE_WORD_WIDTH, 8), modifyWordWidth(b, QUANTIZE_WORD_WIDTH, 8)];
};

quantizedRed = function(color) {
  return color >> (QUANTIZE_WORD_WIDTH + QUANTIZE_WORD_WIDTH) & QUANTIZE_WORD_MASK;
};

quantizedGreen = function(color) {
  return color >> QUANTIZE_WORD_WIDTH & QUANTIZE_WORD_MASK;
};

quantizedBlue = function(color) {
  return color & QUANTIZE_WORD_MASK;
};

module.exports = ColorCutQuantizer = (function() {
  function ColorCutQuantizer(data, opts) {
    var c, color, distinctColorCount, distinctColorIndex, i, j, k, l, m, quantizedColor, ref, ref1, ref2, ref3;
    this.opts = opts;
    this.hist = new Uint32Array(1 << (QUANTIZE_WORD_WIDTH * 3));
    this.pixels = new Uint32Array(data.length);
    for (i = j = 0, ref = data.length - 1; 0 <= ref ? j <= ref : j >= ref; i = 0 <= ref ? ++j : --j) {
      this.pixels[i] = quantizedColor = quantizeFromRgb888(data[i]);
      this.hist[quantizedColor]++;
    }
    distinctColorCount = 0;
    for (color = k = 0, ref1 = this.hist.length - 1; 0 <= ref1 ? k <= ref1 : k >= ref1; color = 0 <= ref1 ? ++k : --k) {
      if (this.hist[color] > 0) {
        distinctColorCount++;
      }
    }
    this.colors = new Uint32Array(distinctColorCount);
    distinctColorIndex = 0;
    for (color = l = 0, ref2 = this.hist.length - 1; 0 <= ref2 ? l <= ref2 : l >= ref2; color = 0 <= ref2 ? ++l : --l) {
      if (this.hist[color] > 0) {
        this.colors[distinctColorIndex++] = color;
      }
    }
    if (distinctColorCount <= this.opts.colorCount) {
      this.quantizedColors = [];
      for (i = m = 0, ref3 = this.colors.length - 1; 0 <= ref3 ? m <= ref3 : m >= ref3; i = 0 <= ref3 ? ++m : --m) {
        c = this.colors[i];
        this.quantizedColors.push(new Swatch(approximateToRgb888(c), this.hist[c]));
      }
    } else {
      this.quantizedColors = this.quantizePixels(this.opts.colorCount);
    }
  }

  ColorCutQuantizer.prototype.getQuantizedColors = function() {
    return this.quantizedColors;
  };

  ColorCutQuantizer.prototype.quantizePixels = function(maxColors) {
    var pq;
    pq = new PriorityQueue({
      comparator: Vbox.comparator
    });
    pq.queue(new Vbox(this.colors, this.hist, 0, this.colors.length - 1));
    this.splitBoxes(pq, maxColors);
    return this.generateAverageColors(pq);
  };

  ColorCutQuantizer.prototype.splitBoxes = function(queue, maxSize) {
    var vbox;
    while (queue.length < maxSize) {
      vbox = queue.dequeue();
      if (vbox != null ? vbox.canSplit() : void 0) {
        queue.queue(vbox.splitBox());
        queue.queue(vbox);
      } else {
        return;
      }
    }
  };

  ColorCutQuantizer.prototype.generateAverageColors = function(vboxes) {
    var colors;
    colors = [];
    while (vboxes.length > 0) {
      colors.push(vboxes.dequeue().getAverageColor());
    }
    return colors;
  };

  return ColorCutQuantizer;

})();

Vbox = (function() {
  Vbox.comparator = function(lhs, rhs) {
    return lhs.getVolume() - rhs.getVolume();
  };

  function Vbox(colors1, hist, lowerIndex, upperIndex) {
    this.colors = colors1;
    this.hist = hist;
    this.lowerIndex = lowerIndex;
    this.upperIndex = upperIndex;
    this.fitBox();
  }

  Vbox.prototype.getVolume = function() {
    return (this.maxRed - this.minRed + 1) * (this.maxGreen - this.minGreen + 1) * (this.maxBlue - this.minBlue + 1);
  };

  Vbox.prototype.canSplit = function() {
    return this.getColorCount() > 1;
  };

  Vbox.prototype.getColorCount = function() {
    return 1 + this.upperIndex - this.lowerIndex;
  };

  Vbox.prototype.fitBox = function() {
    var b, color, count, g, i, j, r, ref, ref1;
    this.minRed = this.minGreen = this.minBlue = Number.MAX_VALUE;
    this.maxRed = this.maxGreen = this.maxBlue = Number.MIN_VALUE;
    this.population = 0;
    count = 0;
    for (i = j = ref = this.lowerIndex, ref1 = this.upperIndex; ref <= ref1 ? j <= ref1 : j >= ref1; i = ref <= ref1 ? ++j : --j) {
      color = this.colors[i];
      count += this.hist[color];
      r = quantizedRed(color);
      g = quantizedGreen(color);
      b = quantizedBlue(color);
      if (r > this.maxRed) {
        this.maxRed = r;
      }
      if (r < this.minRed) {
        this.minRed = r;
      }
      if (g > this.maxGreen) {
        this.maxGreen = g;
      }
      if (g < this.minGreen) {
        this.minGreen = g;
      }
      if (b > this.maxBlue) {
        this.maxRed = b;
      }
      if (b < this.minBlue) {
        this.minRed = b;
      }
    }
    return this.population = count;
  };

  Vbox.prototype.splitBox = function() {
    var newBox, splitPoint;
    if (!this.canSplit()) {
      throw new Error("Cannot split a box with only 1 color");
    }
    splitPoint = this.findSplitPoint();
    newBox = new Vbox(this.colors, this.hist, splitPoint + 1, this.upperIndex);
    this.upperIndex = splitPoint;
    this.fitBox();
    return newBox;
  };

  Vbox.prototype.getLongestColorDimension = function() {
    var blueLength, greenLength, redLength;
    redLength = this.maxRed - this.minRed;
    greenLength = this.maxGreen - this.minGreen;
    blueLength = this.maxBlue - this.minBlue;
    if (redLength >= greenLength && redLength >= blueLength) {
      return COMPONENT_RED;
    }
    if (greenLength >= redLength && greenLength >= blueLength) {
      return COMPONENT_GREEN;
    }
    return COMPONENT_BLUE;
  };

  Vbox.prototype.findSplitPoint = function() {
    var count, i, j, longestDimension, midPoint, ref, ref1;
    longestDimension = this.getLongestColorDimension();
    modifySignificantOctet(this.colors, longestDimension, this.lowerIndex, this.upperIndex);
    sort(this.colors, this.lowerIndex, this.upperIndex + 1);
    modifySignificantOctet(this.colors, longestDimension, this.lowerIndex, this.upperIndex);
    midPoint = this.population / 2;
    count = 0;
    for (i = j = ref = this.lowerIndex, ref1 = this.upperIndex; ref <= ref1 ? j <= ref1 : j >= ref1; i = ref <= ref1 ? ++j : --j) {
      count += this.hist[this.colors[i]];
      if (count >= midPoint) {
        return i;
      }
    }
    return this.lowerIndex;
  };

  Vbox.prototype.getAverageColor = function() {
    var blueMean, blueSum, color, colorPopulation, greenMean, greenSum, i, j, redMean, redSum, ref, ref1, totalPopulation;
    redSum = greenSum = blueSum = 0;
    totalPopulation = 0;
    for (i = j = ref = this.lowerIndex, ref1 = this.upperIndex; ref <= ref1 ? j <= ref1 : j >= ref1; i = ref <= ref1 ? ++j : --j) {
      color = this.colors[i];
      colorPopulation = this.hist[color];
      totalPopulation += colorPopulation;
      redSum += colorPopulation * quantizedRed(color);
      greenSum += colorPopulation * quantizedGreen(color);
      blueSum += colorPopulation * quantizedBlue(color);
    }
    redMean = Math.round(redSum / totalPopulation);
    greenMean = Math.round(greenSum / totalPopulation);
    blueMean = Math.round(blueSum / totalPopulation);
    return new Swatch(approximateToRgb888(redMean, greenMean, blueMean), totalPopulation);
  };

  return Vbox;

})();


},{"../../swatch":24}],18:[function(require,module,exports){
var MMCQ, PQueue, RSHIFT, SIGBITS, Swatch, VBox, getColorIndex, ref, util;

ref = util = require('../../util'), getColorIndex = ref.getColorIndex, SIGBITS = ref.SIGBITS, RSHIFT = ref.RSHIFT;

Swatch = require('../../swatch');

VBox = require('./vbox');

PQueue = require('./pqueue');

module.exports = MMCQ = (function() {
  MMCQ.DefaultOpts = {
    maxIterations: 1000,
    fractByPopulations: 0.75
  };

  function MMCQ(opts) {
    this.opts = util.defaults(opts, this.constructor.DefaultOpts);
  }

  MMCQ.prototype.quantize = function(pixels, opts) {
    var color, colorCount, hist, pq, pq2, shouldIgnore, swatches, v, vbox;
    if (pixels.length === 0 || opts.colorCount < 2 || opts.colorCount > 256) {
      throw new Error("Wrong MMCQ parameters");
    }
    shouldIgnore = function() {
      return false;
    };
    if (Array.isArray(opts.filters) && opts.filters.length > 0) {
      shouldIgnore = function(r, g, b, a) {
        var f, i, len, ref1;
        ref1 = opts.filters;
        for (i = 0, len = ref1.length; i < len; i++) {
          f = ref1[i];
          if (!f(r, g, b, a)) {
            return true;
          }
        }
        return false;
      };
    }
    vbox = VBox.build(pixels, shouldIgnore);
    hist = vbox.hist;
    colorCount = Object.keys(hist).length;
    pq = new PQueue(function(a, b) {
      return a.count() - b.count();
    });
    pq.push(vbox);
    this._splitBoxes(pq, this.opts.fractByPopulations * opts.colorCount);
    pq2 = new PQueue(function(a, b) {
      return a.count() * a.volume() - b.count() * b.volume();
    });
    pq2.contents = pq.contents;
    this._splitBoxes(pq2, opts.colorCount - pq2.size());
    swatches = [];
    this.vboxes = [];
    while (pq2.size()) {
      v = pq2.pop();
      color = v.avg();
      if (!(typeof shouldIgnore === "function" ? shouldIgnore(color[0], color[1], color[2], 255) : void 0)) {
        this.vboxes.push(v);
        swatches.push(new Swatch(color, v.count()));
      }
    }
    return swatches;
  };

  MMCQ.prototype._splitBoxes = function(pq, target) {
    var colorCount, iteration, maxIterations, ref1, vbox, vbox1, vbox2;
    colorCount = 1;
    iteration = 0;
    maxIterations = this.opts.maxIterations;
    while (iteration < maxIterations) {
      iteration++;
      vbox = pq.pop();
      if (!vbox.count()) {
        continue;
      }
      ref1 = vbox.split(), vbox1 = ref1[0], vbox2 = ref1[1];
      pq.push(vbox1);
      if (vbox2) {
        pq.push(vbox2);
        colorCount++;
      }
      if (colorCount >= target || iteration > maxIterations) {
        return;
      }
    }
  };

  return MMCQ;

})();


},{"../../swatch":24,"../../util":25,"./pqueue":19,"./vbox":20}],19:[function(require,module,exports){
var PQueue;

module.exports = PQueue = (function() {
  function PQueue(comparator) {
    this.comparator = comparator;
    this.contents = [];
    this.sorted = false;
  }

  PQueue.prototype._sort = function() {
    this.contents.sort(this.comparator);
    return this.sorted = true;
  };

  PQueue.prototype.push = function(o) {
    this.contents.push(o);
    return this.sorted = false;
  };

  PQueue.prototype.peek = function(index) {
    if (!this.sorted) {
      this._sort();
    }
    if (index == null) {
      index = this.contents.length - 1;
    }
    return this.contents[index];
  };

  PQueue.prototype.pop = function() {
    if (!this.sorted) {
      this._sort();
    }
    return this.contents.pop();
  };

  PQueue.prototype.size = function() {
    return this.contents.length;
  };

  PQueue.prototype.map = function(f) {
    if (!this.sorted) {
      this._sort();
    }
    return this.contents.map(f);
  };

  return PQueue;

})();


},{}],20:[function(require,module,exports){
var RSHIFT, SIGBITS, VBox, getColorIndex, ref, util;

ref = util = require('../../util'), getColorIndex = ref.getColorIndex, SIGBITS = ref.SIGBITS, RSHIFT = ref.RSHIFT;

module.exports = VBox = (function() {
  VBox.build = function(pixels, shouldIgnore) {
    var a, b, bmax, bmin, g, gmax, gmin, hist, hn, i, index, n, offset, r, rmax, rmin;
    hn = 1 << (3 * SIGBITS);
    hist = new Uint32Array(hn);
    rmax = gmax = bmax = 0;
    rmin = gmin = bmin = Number.MAX_VALUE;
    n = pixels.length / 4;
    i = 0;
    while (i < n) {
      offset = i * 4;
      i++;
      r = pixels[offset + 0];
      g = pixels[offset + 1];
      b = pixels[offset + 2];
      a = pixels[offset + 3];
      if (shouldIgnore(r, g, b, a)) {
        continue;
      }
      r = r >> RSHIFT;
      g = g >> RSHIFT;
      b = b >> RSHIFT;
      index = getColorIndex(r, g, b);
      hist[index] += 1;
      if (r > rmax) {
        rmax = r;
      }
      if (r < rmin) {
        rmin = r;
      }
      if (g > gmax) {
        gmax = g;
      }
      if (g < gmin) {
        gmin = g;
      }
      if (b > bmax) {
        bmax = b;
      }
      if (b < bmin) {
        bmin = b;
      }
    }
    return new VBox(rmin, rmax, gmin, gmax, bmin, bmax, hist);
  };

  function VBox(r1, r2, g1, g2, b1, b2, hist1) {
    this.r1 = r1;
    this.r2 = r2;
    this.g1 = g1;
    this.g2 = g2;
    this.b1 = b1;
    this.b2 = b2;
    this.hist = hist1;
  }

  VBox.prototype.invalidate = function() {
    delete this._count;
    delete this._avg;
    return delete this._volume;
  };

  VBox.prototype.volume = function() {
    if (this._volume == null) {
      this._volume = (this.r2 - this.r1 + 1) * (this.g2 - this.g1 + 1) * (this.b2 - this.b1 + 1);
    }
    return this._volume;
  };

  VBox.prototype.count = function() {
    var c, hist;
    if (this._count == null) {
      hist = this.hist;
      c = 0;
      
      for (var r = this.r1; r <= this.r2; r++) {
        for (var g = this.g1; g <= this.g2; g++) {
          for (var b = this.b1; b <= this.b2; b++) {
            var index = getColorIndex(r, g, b);
            c += hist[index];
          }
        }
      }
      ;
      this._count = c;
    }
    return this._count;
  };

  VBox.prototype.clone = function() {
    return new VBox(this.r1, this.r2, this.g1, this.g2, this.b1, this.b2, this.hist);
  };

  VBox.prototype.avg = function() {
    var bsum, gsum, hist, mult, ntot, rsum;
    if (this._avg == null) {
      hist = this.hist;
      ntot = 0;
      mult = 1 << (8 - SIGBITS);
      rsum = gsum = bsum = 0;
      
      for (var r = this.r1; r <= this.r2; r++) {
        for (var g = this.g1; g <= this.g2; g++) {
          for (var b = this.b1; b <= this.b2; b++) {
            var index = getColorIndex(r, g, b);
            var h = hist[index];
            ntot += h;
            rsum += (h * (r + 0.5) * mult);
            gsum += (h * (g + 0.5) * mult);
            bsum += (h * (b + 0.5) * mult);
          }
        }
      }
      ;
      if (ntot) {
        this._avg = [~~(rsum / ntot), ~~(gsum / ntot), ~~(bsum / ntot)];
      } else {
        this._avg = [~~(mult * (this.r1 + this.r2 + 1) / 2), ~~(mult * (this.g1 + this.g2 + 1) / 2), ~~(mult * (this.b1 + this.b2 + 1) / 2)];
      }
    }
    return this._avg;
  };

  VBox.prototype.split = function() {
    var accSum, bw, d, doCut, gw, hist, i, j, maxd, maxw, ref1, reverseSum, rw, splitPoint, sum, total, vbox;
    hist = this.hist;
    if (!this.count()) {
      return null;
    }
    if (this.count() === 1) {
      return [this.clone()];
    }
    rw = this.r2 - this.r1 + 1;
    gw = this.g2 - this.g1 + 1;
    bw = this.b2 - this.b1 + 1;
    maxw = Math.max(rw, gw, bw);
    accSum = null;
    sum = total = 0;
    maxd = null;
    switch (maxw) {
      case rw:
        maxd = 'r';
        accSum = new Uint32Array(this.r2 + 1);
        
        for (var r = this.r1; r <= this.r2; r++) {
          sum = 0
          for (var g = this.g1; g <= this.g2; g++) {
            for (var b = this.b1; b <= this.b2; b++) {
              var index = getColorIndex(r, g, b);
              sum += hist[index];
            }
          }
          total += sum;
          accSum[r] = total;
        }
        ;
        break;
      case gw:
        maxd = 'g';
        accSum = new Uint32Array(this.g2 + 1);
        
        for (var g = this.g1; g <= this.g2; g++) {
          sum = 0
          for (var r = this.r1; r <= this.r2; r++) {
            for (var b = this.b1; b <= this.b2; b++) {
              var index = getColorIndex(r, g, b);
              sum += hist[index];
            }
          }
          total += sum;
          accSum[g] = total;
        }
        ;
        break;
      case bw:
        maxd = 'b';
        accSum = new Uint32Array(this.b2 + 1);
        
        for (var b = this.b1; b <= this.b2; b++) {
          sum = 0
          for (var r = this.r1; r <= this.r2; r++) {
            for (var g = this.g1; g <= this.g2; g++) {
              var index = getColorIndex(r, g, b);
              sum += hist[index];
            }
          }
          total += sum;
          accSum[b] = total;
        }
        ;
    }
    splitPoint = -1;
    reverseSum = new Uint32Array(accSum.length);
    for (i = j = 0, ref1 = accSum.length - 1; 0 <= ref1 ? j <= ref1 : j >= ref1; i = 0 <= ref1 ? ++j : --j) {
      d = accSum[i];
      if (splitPoint < 0 && d > total / 2) {
        splitPoint = i;
      }
      reverseSum[i] = total - d;
    }
    vbox = this;
    doCut = function(d) {
      var c2, d1, d2, dim1, dim2, left, right, vbox1, vbox2;
      dim1 = d + "1";
      dim2 = d + "2";
      d1 = vbox[dim1];
      d2 = vbox[dim2];
      vbox1 = vbox.clone();
      vbox2 = vbox.clone();
      left = splitPoint - d1;
      right = d2 - splitPoint;
      if (left <= right) {
        d2 = Math.min(d2 - 1, ~~(splitPoint + right / 2));
        d2 = Math.max(0, d2);
      } else {
        d2 = Math.max(d1, ~~(splitPoint - 1 - left / 2));
        d2 = Math.min(vbox[dim2], d2);
      }
      while (!accSum[d2]) {
        d2++;
      }
      c2 = reverseSum[d2];
      while (!c2 && accSum[d2 - 1]) {
        c2 = reverseSum[--d2];
      }
      vbox1[dim2] = d2;
      vbox2[dim1] = d2 + 1;
      return [vbox1, vbox2];
    };
    return doCut(maxd);
  };

  VBox.prototype.contains = function(p) {
    var b, g, r;
    r = p[0] >> RSHIFT;
    g = p[1] >> RSHIFT;
    b = p[2] >> RSHIFT;
    return r >= this.r1 && r <= this.r2 && g >= this.g1 && g <= this.g2 && b >= this.b1 && b <= this.b2;
  };

  return VBox;

})();


},{"../../util":25}],21:[function(require,module,exports){
var Quantizer;

module.exports = Quantizer = (function() {
  function Quantizer() {}

  Quantizer.prototype.initialize = function(pixels, opts) {};

  Quantizer.prototype.getQuantizedColors = function() {};

  return Quantizer;

})();

module.exports.Baseline = require('./baseline');

module.exports.NoCopy = require('./nocopy');

module.exports.ColorCut = require('./color-cut');

module.exports.MMCQ = require('./mmcq');


},{"./baseline":15,"./color-cut":16,"./mmcq":22,"./nocopy":23}],22:[function(require,module,exports){
var MMCQ, MMCQImpl, Quantizer, Swatch,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

Swatch = require('../swatch');

Quantizer = require('./index');

MMCQImpl = require('./impl/mmcq');

module.exports = MMCQ = (function(superClass) {
  extend(MMCQ, superClass);

  function MMCQ() {
    return MMCQ.__super__.constructor.apply(this, arguments);
  }

  MMCQ.prototype.initialize = function(pixels, opts) {
    var mmcq;
    this.opts = opts;
    mmcq = new MMCQImpl();
    return this.swatches = mmcq.quantize(pixels, this.opts);
  };

  MMCQ.prototype.getQuantizedColors = function() {
    return this.swatches;
  };

  return MMCQ;

})(Quantizer);


},{"../swatch":24,"./impl/mmcq":18,"./index":21}],23:[function(require,module,exports){
var NoCopyQuantizer, Quantizer, Swatch, quantize,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

Swatch = require('../swatch');

Quantizer = require('./index');

quantize = require('../../vendor-mod/quantize');

module.exports = NoCopyQuantizer = (function(superClass) {
  extend(NoCopyQuantizer, superClass);

  function NoCopyQuantizer() {
    return NoCopyQuantizer.__super__.constructor.apply(this, arguments);
  }

  NoCopyQuantizer.prototype.initialize = function(pixels, opts) {
    var cmap;
    this.opts = opts;
    cmap = quantize(pixels, this.opts);
    return this.swatches = cmap.vboxes.map((function(_this) {
      return function(vbox) {
        return new Swatch(vbox.color, vbox.vbox.count());
      };
    })(this));
  };

  NoCopyQuantizer.prototype.getQuantizedColors = function() {
    return this.swatches;
  };

  return NoCopyQuantizer;

})(Quantizer);


},{"../../vendor-mod/quantize":27,"../swatch":24,"./index":21}],24:[function(require,module,exports){
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


},{"./util":25}],25:[function(require,module,exports){
var Color, DELTAE94, MIN_ALPHA_SEARCH_MAX_ITERATIONS, MIN_ALPHA_SEARCH_PRECISION, RSHIFT, SIGBITS;

DELTAE94 = {
  NA: 0,
  PERFECT: 1,
  CLOSE: 2,
  GOOD: 10,
  SIMILAR: 50
};

SIGBITS = 5;

RSHIFT = 8 - SIGBITS;

MIN_ALPHA_SEARCH_MAX_ITERATIONS = 10;

MIN_ALPHA_SEARCH_PRECISION = 10;

Color = {
  WHITE: [255, 255, 255, 255],
  BLACK: [255, 0, 0, 0],
  alpha: function(argb) {
    return argb[0];
  },
  red: function(argb) {
    return argb[1];
  },
  green: function(argb) {
    return argb[2];
  },
  blue: function(argb) {
    return argb[3];
  },
  argb: function(a, r, g, b) {
    return [a, r, g, b];
  }
};

module.exports = {
  clone: function(o) {
    var _o, key, value;
    if (typeof o === 'object') {
      if (Array.isArray(o)) {
        return o.map((function(_this) {
          return function(v) {
            return _this.clone(v);
          };
        })(this));
      } else {
        _o = {};
        for (key in o) {
          value = o[key];
          _o[key] = this.clone(value);
        }
        return _o;
      }
    }
    return o;
  },
  defaults: function() {
    var _o, i, key, len, o, value;
    o = {};
    for (i = 0, len = arguments.length; i < len; i++) {
      _o = arguments[i];
      for (key in _o) {
        value = _o[key];
        if (o[key] == null) {
          o[key] = this.clone(value);
        }
      }
    }
    return o;
  },
  hexToRgb: function(hex) {
    var m;
    m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (m != null) {
      return [m[1], m[2], m[3]].map(function(s) {
        return parseInt(s, 16);
      });
    }
    return null;
  },
  rgbToHex: function(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1, 7);
  },
  rgbToHsl: function(r, g, b) {
    var d, h, l, max, min, s;
    r /= 255;
    g /= 255;
    b /= 255;
    max = Math.max(r, g, b);
    min = Math.min(r, g, b);
    h = void 0;
    s = void 0;
    l = (max + min) / 2;
    if (max === min) {
      h = s = 0;
    } else {
      d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
      }
      h /= 6;
    }
    return [h, s, l];
  },
  hslToRgb: function(h, s, l) {
    var b, g, hue2rgb, p, q, r;
    r = void 0;
    g = void 0;
    b = void 0;
    hue2rgb = function(p, q, t) {
      if (t < 0) {
        t += 1;
      }
      if (t > 1) {
        t -= 1;
      }
      if (t < 1 / 6) {
        return p + (q - p) * 6 * t;
      }
      if (t < 1 / 2) {
        return q;
      }
      if (t < 2 / 3) {
        return p + (q - p) * (2 / 3 - t) * 6;
      }
      return p;
    };
    if (s === 0) {
      r = g = b = l;
    } else {
      q = l < 0.5 ? l * (1 + s) : l + s - (l * s);
      p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - (1 / 3));
    }
    return [r * 255, g * 255, b * 255];
  },
  rgbToXyz: function(r, g, b) {
    var x, y, z;
    r /= 255;
    g /= 255;
    b /= 255;
    r = r > 0.04045 ? Math.pow((r + 0.005) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.005) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.005) / 1.055, 2.4) : b / 12.92;
    r *= 100;
    g *= 100;
    b *= 100;
    x = r * 0.4124 + g * 0.3576 + b * 0.1805;
    y = r * 0.2126 + g * 0.7152 + b * 0.0722;
    z = r * 0.0193 + g * 0.1192 + b * 0.9505;
    return [x, y, z];
  },
  xyzToCIELab: function(x, y, z) {
    var L, REF_X, REF_Y, REF_Z, a, b;
    REF_X = 95.047;
    REF_Y = 100;
    REF_Z = 108.883;
    x /= REF_X;
    y /= REF_Y;
    z /= REF_Z;
    x = x > 0.008856 ? Math.pow(x, 1 / 3) : 7.787 * x + 16 / 116;
    y = y > 0.008856 ? Math.pow(y, 1 / 3) : 7.787 * y + 16 / 116;
    z = z > 0.008856 ? Math.pow(z, 1 / 3) : 7.787 * z + 16 / 116;
    L = 116 * y - 16;
    a = 500 * (x - y);
    b = 200 * (y - z);
    return [L, a, b];
  },
  rgbToCIELab: function(r, g, b) {
    var ref, x, y, z;
    ref = this.rgbToXyz(r, g, b), x = ref[0], y = ref[1], z = ref[2];
    return this.xyzToCIELab(x, y, z);
  },
  deltaE94: function(lab1, lab2) {
    var L1, L2, WEIGHT_C, WEIGHT_H, WEIGHT_L, a1, a2, b1, b2, dL, da, db, xC1, xC2, xDC, xDE, xDH, xDL, xSC, xSH;
    WEIGHT_L = 1;
    WEIGHT_C = 1;
    WEIGHT_H = 1;
    L1 = lab1[0], a1 = lab1[1], b1 = lab1[2];
    L2 = lab2[0], a2 = lab2[1], b2 = lab2[2];
    dL = L1 - L2;
    da = a1 - a2;
    db = b1 - b2;
    xC1 = Math.sqrt(a1 * a1 + b1 * b1);
    xC2 = Math.sqrt(a2 * a2 + b2 * b2);
    xDL = L2 - L1;
    xDC = xC2 - xC1;
    xDE = Math.sqrt(dL * dL + da * da + db * db);
    if (Math.sqrt(xDE) > Math.sqrt(Math.abs(xDL)) + Math.sqrt(Math.abs(xDC))) {
      xDH = Math.sqrt(xDE * xDE - xDL * xDL - xDC * xDC);
    } else {
      xDH = 0;
    }
    xSC = 1 + 0.045 * xC1;
    xSH = 1 + 0.015 * xC1;
    xDL /= WEIGHT_L;
    xDC /= WEIGHT_C * xSC;
    xDH /= WEIGHT_H * xSH;
    return Math.sqrt(xDL * xDL + xDC * xDC + xDH * xDH);
  },
  rgbDiff: function(rgb1, rgb2) {
    var lab1, lab2;
    lab1 = this.rgbToCIELab.apply(this, rgb1);
    lab2 = this.rgbToCIELab.apply(this, rgb2);
    return this.deltaE94(lab1, lab2);
  },
  hexDiff: function(hex1, hex2) {
    var rgb1, rgb2;
    rgb1 = this.hexToRgb(hex1);
    rgb2 = this.hexToRgb(hex2);
    return this.rgbDiff(rgb1, rgb2);
  },
  DELTAE94_DIFF_STATUS: DELTAE94,
  getColorDiffStatus: function(d) {
    if (d < DELTAE94.NA) {
      return "N/A";
    }
    if (d <= DELTAE94.PERFECT) {
      return "Perfect";
    }
    if (d <= DELTAE94.CLOSE) {
      return "Close";
    }
    if (d <= DELTAE94.GOOD) {
      return "Good";
    }
    if (d < DELTAE94.SIMILAR) {
      return "Similar";
    }
    return "Wrong";
  },
  SIGBITS: SIGBITS,
  RSHIFT: RSHIFT,
  getColorIndex: function(r, g, b) {
    return (r << (2 * SIGBITS)) + (g << SIGBITS) + b;
  },
  Color: Color,
  calculateMinimumAlpha: function(foreground, background, minContrastRatio) {
    var maxAlpha, minAlpha, numIterations, testAlpha, testForeground, testRatio;
    if ((Color.alpha(background)) !== 255) {
      throw new Error("background can not be translucent");
    }
    testForeground = this.setAlphaComponent(foreground, 255);
    testRatio = this.calculateContrast(testForeground, background);
    if (testRatio < minContrastRatio) {
      return -1;
    }
    numIterations = 0;
    minAlpha = 0;
    maxAlpha = 255;
    while ((numIterations <= MIN_ALPHA_SEARCH_MAX_ITERATIONS) && ((maxAlpha - minAlpha) > MIN_ALPHA_SEARCH_PRECISION)) {
      testAlpha = Math.floor((minAlpha + maxAlpha) / 2);
      testForeground = this.setAlphaComponent(foreground, testAlpha);
      testRatio = this.calculateContrast(testForeground, background);
      if (testRatio < minContrastRatio) {
        minAlpha = testAlpha;
      } else {
        maxAlpha = testAlpha;
      }
      numIterations += 1;
    }
    return maxAlpha;
  },
  setAlphaComponent: function(color, alpha) {
    return [alpha, color[1], color[2], color[3]];
  },
  calculateContrast: function(foreground, background) {
    var luminance1, luminance2;
    if ((Color.alpha(background)) !== 255) {
      throw new Error('background can not be translucent');
    }
    if ((Color.alpha(foreground)) < 255) {
      foreground = this.compositeColors(foreground, background);
    }
    luminance1 = (this.calculateLuminance(foreground)) + 0.05;
    luminance2 = (this.calculateLuminance(background)) + 0.05;
    return (Math.max(luminance1, luminance2)) / (Math.min(luminance1, luminance2));
  },
  calculateLuminance: function(argb) {
    var blue, green, red;
    red = Color.red(argb) / 255.0;
    red = red < 0.03928 ? red / 12.92 : Math.pow((red + 0.055) / 1.055, 2.4);
    green = Color.green(argb) / 255.0;
    green = green < 0.03928 ? green / 12.92 : Math.pow((green + 0.055) / 1.055, 2.4);
    blue = Color.blue(argb) / 255.0;
    blue = blue < 0.03928 ? blue / 12.92 : Math.pow((blue + 0.055) / 1.055, 2.4);
    return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
  },
  compositeColors: function(fg, bg) {
    var a, alpha1, alpha2, b, g, r;
    alpha1 = Color.alpha(fg) / 255.0;
    alpha2 = Color.alpha(bg) / 255.0;
    a = (alpha1 + alpha2) * (1.0 - alpha1);
    r = (Color.red(fg) * alpha1) + (Color.red(bg) * alpha2 * (1.0 - alpha1));
    g = (Color.green(fg) * alpha1) + (Color.green(bg) * alpha2 * (1.0 - alpha1));
    b = (Color.blue(fg) * alpha1) + (Color.blue(bg) * alpha2 * (1.0 - alpha1));
    return Color.argb(a, r, g, b);
  }
};


},{}],26:[function(require,module,exports){

/*
  From Vibrant.js by Jari Zwarts
  Ported to node.js by AKFish

  Color algorithm class that finds variations on colors in an image.

  Credits
  --------
  Lokesh Dhakar (http://www.lokeshdhakar.com) - Created ColorThief
  Google - Palette support library in Android
 */
var Builder, DefaultGenerator, Filter, Swatch, Vibrant, util,
  bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; };

Swatch = require('./swatch');

util = require('./util');

DefaultGenerator = require('./generator').Default;

Filter = require('./filter');

module.exports = Vibrant = (function() {
  Vibrant.DefaultOpts = {
    colorCount: 64,
    quality: 5,
    generator: new DefaultGenerator(),
    Image: null,
    Quantizer: require('./quantizer').MMCQ,
    filters: []
  };

  Vibrant.from = function(src) {
    return new Builder(src);
  };

  Vibrant.prototype.quantize = require('quantize');

  Vibrant.prototype._swatches = [];

  function Vibrant(sourceImage, opts) {
    this.sourceImage = sourceImage;
    if (opts == null) {
      opts = {};
    }
    this.swatches = bind(this.swatches, this);
    this.opts = util.defaults(opts, this.constructor.DefaultOpts);
    this.generator = this.opts.generator;
  }

  Vibrant.prototype.getPalette = function(cb) {
    var image;
    return image = new this.opts.Image(this.sourceImage, (function(_this) {
      return function(err, image) {
        var error, error1;
        if (err != null) {
          return cb(err);
        }
        try {
          _this._process(image, _this.opts);
          return cb(null, _this.swatches());
        } catch (error1) {
          error = error1;
          return cb(error);
        }
      };
    })(this));
  };

  Vibrant.prototype.getSwatches = function(cb) {
    return this.getPalette(cb);
  };

  Vibrant.prototype._process = function(image, opts) {
    var imageData, quantizer, swatches;
    image.scaleDown(this.opts);
    imageData = image.getImageData();
    quantizer = new this.opts.Quantizer();
    quantizer.initialize(imageData.data, this.opts);
    swatches = quantizer.getQuantizedColors();
    this.generator.generate(swatches);
    return image.removeCanvas();
  };

  Vibrant.prototype.swatches = function() {
    return {
      Vibrant: this.generator.getVibrantSwatch(),
      Muted: this.generator.getMutedSwatch(),
      DarkVibrant: this.generator.getDarkVibrantSwatch(),
      DarkMuted: this.generator.getDarkMutedSwatch(),
      LightVibrant: this.generator.getLightVibrantSwatch(),
      LightMuted: this.generator.getLightMutedSwatch()
    };
  };

  return Vibrant;

})();

module.exports.Builder = Builder = (function() {
  function Builder(src1, opts1) {
    this.src = src1;
    this.opts = opts1 != null ? opts1 : {};
    this.opts.filters = util.clone(Vibrant.DefaultOpts.filters);
  }

  Builder.prototype.maxColorCount = function(n) {
    this.opts.colorCount = n;
    return this;
  };

  Builder.prototype.maxDimension = function(d) {
    this.opts.maxDimension = d;
    return this;
  };

  Builder.prototype.addFilter = function(f) {
    if (typeof f === 'function') {
      this.opts.filters.push(f);
    }
    return this;
  };

  Builder.prototype.removeFilter = function(f) {
    var i;
    if ((i = this.opts.filters.indexOf(f)) > 0) {
      this.opts.filters.splice(i);
    }
    return this;
  };

  Builder.prototype.clearFilters = function() {
    this.opts.filters = [];
    return this;
  };

  Builder.prototype.quality = function(q) {
    this.opts.quality = q;
    return this;
  };

  Builder.prototype.useImage = function(image) {
    this.opts.Image = image;
    return this;
  };

  Builder.prototype.useGenerator = function(generator) {
    this.opts.generator = generator;
    return this;
  };

  Builder.prototype.useQuantizer = function(quantizer) {
    this.opts.Quantizer = quantizer;
    return this;
  };

  Builder.prototype.build = function() {
    if (this.v == null) {
      this.v = new Vibrant(this.src, this.opts);
    }
    return this.v;
  };

  Builder.prototype.getSwatches = function(cb) {
    return this.build().getPalette(cb);
  };

  Builder.prototype.getPalette = function(cb) {
    return this.build().getPalette(cb);
  };

  Builder.prototype.from = function(src) {
    return new Vibrant(src, this.opts);
  };

  return Builder;

})();

module.exports.Util = util;

module.exports.Swatch = Swatch;

module.exports.Quantizer = require('./quantizer/');

module.exports.Generator = require('./generator/');

module.exports.Filter = require('./filter/');


},{"./filter":10,"./filter/":10,"./generator":12,"./generator/":12,"./quantizer":21,"./quantizer/":21,"./swatch":24,"./util":25,"quantize":6}],27:[function(require,module,exports){
/*
 * quantize.js Copyright 2008 Nick Rabinowitz
 * Ported to node.js by Olivier Lesnicki
 * Licensed under the MIT license: http://www.opensource.org/licenses/mit-license.php
 */

// fill out a couple protovis dependencies
/*
 * Block below copied from Protovis: http://mbostock.github.com/protovis/
 * Copyright 2010 Stanford Visualization Group
 * Licensed under the BSD License: http://www.opensource.org/licenses/bsd-license.php
 */
if (!pv) {
    var pv = {
        map: function(array, f) {
            var o = {};
            return f ? array.map(function(d, i) {
                o.index = i;
                return f.call(o, d);
            }) : array.slice();
        },
        naturalOrder: function(a, b) {
            return a - b;
        },
        sum: function(array, f) {
            var o = {};
            return array.reduce(f ? function(p, d, i) {
                o.index = i;
                return p + f.call(o, d);
            } : function(p, d) {
                return p + d;
            }, 0);
        },
        max: function(array, f) {
            return Math.max.apply(null, f ? pv.map(array, f) : array);
        }
    }
}

/**
 * Basic Javascript port of the MMCQ (modified median cut quantization)
 * algorithm from the Leptonica library (http://www.leptonica.com/).
 * Returns a color map you can use to map original pixels to the reduced
 * palette. Still a work in progress.
 *
 * @author Nick Rabinowitz
 * @example

// array of pixels as [R,G,B] arrays
var myPixels = [[190,197,190], [202,204,200], [207,214,210], [211,214,211], [205,207,207]
                // etc
                ];
var maxColors = 4;

var cmap = MMCQ.quantize(myPixels, maxColors);
var newPalette = cmap.palette();
var newPixels = myPixels.map(function(p) {
    return cmap.map(p);
});

 */
var MMCQ = (function() {
    // private constants
    var sigbits = 5,
        rshift = 8 - sigbits,
        maxIterations = 1000,
        fractByPopulations = 0.75;

    // get reduced-space color index for a pixel

    function getColorIndex(r, g, b) {
        return (r << (2 * sigbits)) + (g << sigbits) + b;
    }

    // Simple priority queue

    function PQueue(comparator) {
        var contents = [],
            sorted = false;

        function sort() {
            contents.sort(comparator);
            sorted = true;
        }

        return {
            push: function(o) {
                contents.push(o);
                sorted = false;
            },
            peek: function(index) {
                if (!sorted) sort();
                if (index === undefined) index = contents.length - 1;
                return contents[index];
            },
            pop: function() {
                if (!sorted) sort();
                return contents.pop();
            },
            size: function() {
                return contents.length;
            },
            map: function(f) {
                return contents.map(f);
            },
            debug: function() {
                if (!sorted) sort();
                return contents;
            }
        };
    }

    // 3d color space box

    function VBox(r1, r2, g1, g2, b1, b2, histo) {
        var vbox = this;
        vbox.r1 = r1;
        vbox.r2 = r2;
        vbox.g1 = g1;
        vbox.g2 = g2;
        vbox.b1 = b1;
        vbox.b2 = b2;
        vbox.histo = histo;
    }
    VBox.prototype = {
        volume: function(force) {
            var vbox = this;
            if (!vbox._volume || force) {
                vbox._volume = ((vbox.r2 - vbox.r1 + 1) * (vbox.g2 - vbox.g1 + 1) * (vbox.b2 - vbox.b1 + 1));
            }
            return vbox._volume;
        },
        count: function(force) {
            var vbox = this,
                histo = vbox.histo;
            if (!vbox._count_set || force) {
                var npix = 0,
                    i, j, k;
                for (i = vbox.r1; i <= vbox.r2; i++) {
                    for (j = vbox.g1; j <= vbox.g2; j++) {
                        for (k = vbox.b1; k <= vbox.b2; k++) {
                            index = getColorIndex(i, j, k);
                            npix += histo[index];
                        }
                    }
                }
                vbox._count = npix;
                vbox._count_set = true;
            }
            return vbox._count;
        },
        copy: function() {
            var vbox = this;
            return new VBox(vbox.r1, vbox.r2, vbox.g1, vbox.g2, vbox.b1, vbox.b2, vbox.histo);
        },
        avg: function(force) {
            var vbox = this,
                histo = vbox.histo;
            if (!vbox._avg || force) {
                var ntot = 0,
                    mult = 1 << (8 - sigbits),
                    // mult = (8 - sigbits),
                    rsum = 0,
                    gsum = 0,
                    bsum = 0,
                    hval,
                    i, j, k, histoindex;
                for (i = vbox.r1; i <= vbox.r2; i++) {
                    for (j = vbox.g1; j <= vbox.g2; j++) {
                        for (k = vbox.b1; k <= vbox.b2; k++) {
                            histoindex = getColorIndex(i, j, k);
                            hval = histo[histoindex];
                            ntot += hval;
                            rsum += (hval * (i + 0.5) * mult);
                            gsum += (hval * (j + 0.5) * mult);
                            bsum += (hval * (k + 0.5) * mult);
                        }
                    }
                }
                if (ntot) {
                    vbox._avg = [~~(rsum / ntot), ~~ (gsum / ntot), ~~ (bsum / ntot)];
                } else {
                    //console.log('empty box');
                    vbox._avg = [~~(mult * (vbox.r1 + vbox.r2 + 1) / 2), ~~ (mult * (vbox.g1 + vbox.g2 + 1) / 2), ~~ (mult * (vbox.b1 + vbox.b2 + 1) / 2)];
                }
            }
            return vbox._avg;
        },
        contains: function(pixel) {
            var vbox = this,
                rval = pixel[0] >> rshift;
            gval = pixel[1] >> rshift;
            bval = pixel[2] >> rshift;
            return (rval >= vbox.r1 && rval <= vbox.r2 &&
                gval >= vbox.g1 && gval <= vbox.g2 &&
                bval >= vbox.b1 && bval <= vbox.b2);
        }
    };

    // Color map

    function CMap() {
        this.vboxes = new PQueue(function(a, b) {
            return pv.naturalOrder(
                a.vbox.count() * a.vbox.volume(),
                b.vbox.count() * b.vbox.volume()
            )
        });;
    }
    CMap.prototype = {
        push: function(vbox) {
            this.vboxes.push({
                vbox: vbox,
                color: vbox.avg()
            });
        },
        palette: function() {
            return this.vboxes.map(function(vb) {
                return vb.color
            });
        },
        size: function() {
            return this.vboxes.size();
        },
        map: function(color) {
            var vboxes = this.vboxes;
            for (var i = 0; i < vboxes.size(); i++) {
                if (vboxes.peek(i).vbox.contains(color)) {
                    return vboxes.peek(i).color;
                }
            }
            return this.nearest(color);
        },
        nearest: function(color) {
            var vboxes = this.vboxes,
                d1, d2, pColor;
            for (var i = 0; i < vboxes.size(); i++) {
                d2 = Math.sqrt(
                    Math.pow(color[0] - vboxes.peek(i).color[0], 2) +
                    Math.pow(color[1] - vboxes.peek(i).color[1], 2) +
                    Math.pow(color[2] - vboxes.peek(i).color[2], 2)
                );
                if (d2 < d1 || d1 === undefined) {
                    d1 = d2;
                    pColor = vboxes.peek(i).color;
                }
            }
            return pColor;
        },
        forcebw: function() {
            // XXX: won't  work yet
            var vboxes = this.vboxes;
            vboxes.sort(function(a, b) {
                return pv.naturalOrder(pv.sum(a.color), pv.sum(b.color))
            });

            // force darkest color to black if everything < 5
            var lowest = vboxes[0].color;
            if (lowest[0] < 5 && lowest[1] < 5 && lowest[2] < 5)
                vboxes[0].color = [0, 0, 0];

            // force lightest color to white if everything > 251
            var idx = vboxes.length - 1,
                highest = vboxes[idx].color;
            if (highest[0] > 251 && highest[1] > 251 && highest[2] > 251)
                vboxes[idx].color = [255, 255, 255];
        }
    };


    function getAll(pixels, shouldIgnore) {
        var histosize = 1 << (3 * sigbits),
            histo = new Uint32Array(histosize),
            index, rval, gval, bval;
        var rmin = 1000000,
            rmax = 0,
            gmin = 1000000,
            gmax = 0,
            bmin = 1000000,
            bmax = 0;

        var pixelCount = pixels.length / 4,
            i = 0;

        // Yes, it matters
        if (typeof shouldIgnore === 'function') {
          while (i < pixelCount) {
              offset = i * 4;
              i++;
              r = pixels[offset + 0];
              g = pixels[offset + 1];
              b = pixels[offset + 2];
              a = pixels[offset + 3];
              if (shouldIgnore(r, g, b, a)) continue;
              rval = r >> rshift;
              gval = g >> rshift;
              bval = b >> rshift;
              index = getColorIndex(rval, gval, bval);
              histo[index]++;
              if (rval < rmin) rmin = rval;
              else if (rval > rmax) rmax = rval;
              if (gval < gmin) gmin = gval;
              else if (gval > gmax) gmax = gval;
              if (bval < bmin) bmin = bval;
              else if (bval > bmax) bmax = bval;
          }
        } else {
          while (i < pixelCount) {
              offset = i * 4;
              i++;
              r = pixels[offset + 0];
              g = pixels[offset + 1];
              b = pixels[offset + 2];
              a = pixels[offset + 3];
              rval = r >> rshift;
              gval = g >> rshift;
              bval = b >> rshift;
              index = getColorIndex(rval, gval, bval);
              histo[index]++;
              if (rval < rmin) rmin = rval;
              else if (rval > rmax) rmax = rval;
              if (gval < gmin) gmin = gval;
              else if (gval > gmax) gmax = gval;
              if (bval < bmin) bmin = bval;
              else if (bval > bmax) bmax = bval;
          }
        }

        return {
          histo: histo,
          vbox: new VBox(rmin, rmax, gmin, gmax, bmin, bmax, histo)
        };
    }

    // histo (1-d array, giving the number of pixels in
    // each quantized region of color space), or null on error

    function getHisto(pixels, shouldIgnore) {
        var histosize = 1 << (3 * sigbits),
            histo = new Uint32Array(histosize),
            index, rval, gval, bval;

        var pixelCount = pixels.length / 4,
            i = 0;

        // Yes, it matters
        if (typeof shouldIgnore === 'function') {
          while (i < pixelCount) {
              offset = i * 4;
              i++;
              r = pixels[offset + 0];
              g = pixels[offset + 1];
              b = pixels[offset + 2];
              a = pixels[offset + 3];
              if (shouldIgnore(r, g, b, a)) continue;
              rval = r >> rshift;
              gval = g >> rshift;
              bval = b >> rshift;
              index = getColorIndex(rval, gval, bval);
              histo[index]++;
          }
        } else {
          while (i < pixelCount) {
              offset = i * 4;
              i++;
              r = pixels[offset + 0];
              g = pixels[offset + 1];
              b = pixels[offset + 2];
              a = pixels[offset + 3];
              rval = r >> rshift;
              gval = g >> rshift;
              bval = b >> rshift;
              index = getColorIndex(rval, gval, bval);
              histo[index]++;
          }
        }

        return histo;
    }

    function vboxFromPixels(pixels, histo, shouldIgnore) {
        var rmin = 1000000,
            rmax = 0,
            gmin = 1000000,
            gmax = 0,
            bmin = 1000000,
            bmax = 0,
            rval, gval, bval;
        // find min/max
        var pixelCount = pixels.length / 4,
            i = 0;

        // Yes, it matters
        if (typeof shouldIgnore === 'function') {
          while (i < pixelCount) {
              offset = i * 4;
              i++;
              r = pixels[offset + 0];
              g = pixels[offset + 1];
              b = pixels[offset + 2];
              a = pixels[offset + 3];
              if (shouldIgnore(r, g, b, a)) continue;
              rval = r >> rshift;
              gval = g >> rshift;
              bval = b >> rshift;
              if (rval < rmin) rmin = rval;
              else if (rval > rmax) rmax = rval;
              if (gval < gmin) gmin = gval;
              else if (gval > gmax) gmax = gval;
              if (bval < bmin) bmin = bval;
              else if (bval > bmax) bmax = bval;
          }
        } else {
            while (i < pixelCount) {
              offset = i * 4;
              i++;
              r = pixels[offset + 0];
              g = pixels[offset + 1];
              b = pixels[offset + 2];
              a = pixels[offset + 3];
              rval = r >> rshift;
              gval = g >> rshift;
              bval = b >> rshift;
              if (rval < rmin) rmin = rval;
              else if (rval > rmax) rmax = rval;
              if (gval < gmin) gmin = gval;
              else if (gval > gmax) gmax = gval;
              if (bval < bmin) bmin = bval;
              else if (bval > bmax) bmax = bval;
          }
        }
        return new VBox(rmin, rmax, gmin, gmax, bmin, bmax, histo);
    }

    function medianCutApply(histo, vbox) {
        if (!vbox.count()) return;

        var rw = vbox.r2 - vbox.r1 + 1,
            gw = vbox.g2 - vbox.g1 + 1,
            bw = vbox.b2 - vbox.b1 + 1,
            maxw = pv.max([rw, gw, bw]);
        // only one pixel, no split
        if (vbox.count() == 1) {
            return [vbox.copy()]
        }
        /* Find the partial sum arrays along the selected axis. */
        var total = 0,
            partialsum,
            lookaheadsum,
            i, j, k, sum, index;
        // var D = ['r', 'g', 'b'],
        //   indexer = getColorIndex;
        // if (maxw == gw) {
        //   D = ['g', 'r', 'b'];
        //   indexer = function(g, r, b) { return getColorIndex(r, g, b); };
        // } else if (maxw == bw) {
        //   indexer = function(b, r, g) { return getColorIndex(r, g, b); };
        //   D = ['b', 'r', 'g'];
        // }
        // partialsum = new Uint32Array(vbox[D[0] + "2"] + 1);
        // console.log(vbox[D[0] + "2"])
        // for (i = vbox[D[0] + "1"]; i <= vbox[D[0] + "2"]; i++) {
        //     sum = 0;
        //     for (j = vbox[D[1] + "1"]; j <= vbox[D[1] + "2"]; j++) {
        //         for (k = vbox[D[2] + "1"]; k <= vbox[D[2] + "2"]; k++) {
        //             index = indexer(i, j, k);
        //             sum += histo[index];
        //         }
        //     }
        //     total += sum;
        //     console.log(i + "->" + total)
        //     partialsum[i] = total;
        // }
        var maxd = 'b';
        if (maxw == rw) {
            maxd = 'r';
            partialsum = new Uint32Array(vbox.r2 + 1);
            for (i = vbox.r1; i <= vbox.r2; i++) {
                sum = 0;
                for (j = vbox.g1; j <= vbox.g2; j++) {
                    for (k = vbox.b1; k <= vbox.b2; k++) {
                        index = getColorIndex(i, j, k);
                        sum += histo[index];
                    }
                }
                total += sum;
                partialsum[i] = total;
            }
        } else if (maxw == gw) {
            maxd = 'g';
            partialsum = new Uint32Array(vbox.g2 + 1);
            for (i = vbox.g1; i <= vbox.g2; i++) {
                sum = 0;
                for (j = vbox.r1; j <= vbox.r2; j++) {
                    for (k = vbox.b1; k <= vbox.b2; k++) {
                        index = getColorIndex(j, i, k);
                        sum += histo[index];
                    }
                }
                total += sum;
                partialsum[i] = total;
            }
        } else { /* maxw == bw */
            // maxd = 'b';
            partialsum = new Uint32Array(vbox.b2 + 1);
            for (i = vbox.b1; i <= vbox.b2; i++) {
                sum = 0;
                for (j = vbox.r1; j <= vbox.r2; j++) {
                    for (k = vbox.g1; k <= vbox.g2; k++) {
                        index = getColorIndex(j, k, i);
                        sum += histo[index];
                    }
                }
                total += sum;
                partialsum[i] = total;
            }
        }
        var splitPoint = -1;
        lookaheadsum = new Uint32Array(partialsum.length);
        for (i = 0; i < partialsum.length; i++) {
          var d = partialsum[i];
          if (splitPoint < 0 && d > (total / 2)) splitPoint = i;
          lookaheadsum[i] = total - d
        }
        // partialsum.forEach(function(d, i) {
        //   if (splitPoint < 0 && d > (total / 2)) splitPoint = i
        //     lookaheadsum[i] = total - d
        // });

        // console.log('cut')
        function doCut(color) {
            var dim1 = color + '1',
                dim2 = color + '2',
                left, right, vbox1, vbox2, d2, count2 = 0,
                i = splitPoint;
            vbox1 = vbox.copy();
            vbox2 = vbox.copy();
            left = i - vbox[dim1];
            right = vbox[dim2] - i;
            if (left <= right) {
                d2 = Math.min(vbox[dim2] - 1, ~~ (i + right / 2));
                d2 = Math.max(0, d2);
            } else {
                d2 = Math.max(vbox[dim1], ~~ (i - 1 - left / 2));
                d2 = Math.min(vbox[dim2], d2);
            }
            // console.log(partialsum[d2])
            // avoid 0-count boxes
            while (!partialsum[d2]) d2++;
            count2 = lookaheadsum[d2];
            // console.log('-_-')
            while (!count2 && partialsum[d2 - 1]) count2 = lookaheadsum[--d2];
            // set dimensions
            vbox1[dim2] = d2;
            vbox2[dim1] = vbox1[dim2] + 1;
            // console.log('vbox counts:', vbox.count(), vbox1.count(), vbox2.count());
            return [vbox1, vbox2];

        }
        // determine the cut planes
        return doCut(maxd);
        // return maxw == rw ? doCut('r') :
        //     maxw == gw ? doCut('g') :
        //     doCut('b');
    }

    function quantize(pixels, opts) {
        var maxcolors = opts.colorCount;
        // short-circuit
        if (!pixels.length || maxcolors < 2 || maxcolors > 256) {
            // console.log('wrong number of maxcolors');
            return false;
        }

        var hasFilters = Array.isArray(opts.filters) && opts.filters.length > 0;
        function shouldIgnore(r, g, b, a) {
          for (var i = 0; i < opts.filters.length; i++) {
            var f = opts.filters[i];
            if (!f(r, g, b, a)) {
              return true;
            }
          }
          return false;
        }

        var r = getAll(pixels, hasFilters ? houldIgnore : null);
        // XXX: check color content and convert to grayscale if insufficient

        // var histo = getHisto(pixels, hasFilters ? shouldIgnore : null),
        var histo = r.histo,
            histosize = 1 << (3 * sigbits);

        // check that we aren't below maxcolors already
        var nColors = Object.keys(histo).length;
        if (nColors <= maxcolors) {
            // XXX: generate the new colors from the histo and return
        }

        // get the beginning vbox from the colors
        // var vbox = vboxFromPixels(pixels, histo, hasFilters ? shouldIgnore : null),
        var vbox = r.vbox,
            pq = new PQueue(function(a, b) {
                return pv.naturalOrder(a.count(), b.count())
            });
        pq.push(vbox);

        // inner function to do the iteration

        function iter(lh, target) {
            var ncolors = 1,
                niters = 0,
                vbox;
            while (niters < maxIterations) {
                vbox = lh.pop();
                if (!vbox.count()) { /* just put it back */
                    // lh.push(vbox); // Maybe not
                    niters++;
                    continue;
                }
                // do the cut
                var vboxes = medianCutApply(histo, vbox),
                    vbox1 = vboxes[0],
                    vbox2 = vboxes[1];

                if (!vbox1) {
                    // console.log("vbox1 not defined; shouldn't happen!");
                    return;
                }
                lh.push(vbox1);
                if (vbox2) { /* vbox2 can be null */
                    lh.push(vbox2);
                    ncolors++;
                }
                if (ncolors >= target) return;
                if (niters++ > maxIterations) {
                    return;
                }
            }
        }

        // first set of colors, sorted by population
        iter(pq, fractByPopulations * maxcolors);
        // console.log(pq.size(), pq.debug().length, pq.debug().slice());

        // Re-sort by the product of pixel occupancy times the size in color space.
        var pq2 = new PQueue(function(a, b) {
            return pv.naturalOrder(a.count() * a.volume(), b.count() * b.volume())
        });
        while (pq.size()) {
            pq2.push(pq.pop());
        }

        // next set - generate the median cuts using the (npix * vol) sorting.
        iter(pq2, maxcolors - pq2.size());

        // calculate the actual colors
        var cmap = new CMap();
        while (pq2.size()) {
            var v = pq2.pop(),
              c = vbox.avg();
            if (!hasFilters || !shouldIgnore(c[0], c[1], c[2], 255)) {
              cmap.push(v);
            }
        }

        return cmap;
    }

    return {
        quantize: quantize,
        getAll: getAll,
        medianCutApply: medianCutApply
    }
})();

module.exports = MMCQ.quantize
module.exports.getAll = MMCQ.getAll
module.exports.splitBox = MMCQ.medianCutApply

},{}]},{},[8])
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcHVueWNvZGUvcHVueWNvZGUuanMiLCJub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvcXVlcnlzdHJpbmctZXMzL2RlY29kZS5qcyIsIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9xdWVyeXN0cmluZy1lczMvZW5jb2RlLmpzIiwibm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL3F1ZXJ5c3RyaW5nLWVzMy9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy91cmwvdXJsLmpzIiwibm9kZV9tb2R1bGVzL3F1YW50aXplL3F1YW50aXplLmpzIiwiL1VzZXJzL3NpbW9uL2Rldi9ub2RlLXZpYnJhbnQvc3JjL2Jyb3dzZXIuY29mZmVlIiwiL1VzZXJzL3NpbW9uL2Rldi9ub2RlLXZpYnJhbnQvc3JjL2J1bmRsZS5jb2ZmZWUiLCIvVXNlcnMvc2ltb24vZGV2L25vZGUtdmlicmFudC9zcmMvZmlsdGVyL2RlZmF1bHQuY29mZmVlIiwiL1VzZXJzL3NpbW9uL2Rldi9ub2RlLXZpYnJhbnQvc3JjL2ZpbHRlci9pbmRleC5jb2ZmZWUiLCIvVXNlcnMvc2ltb24vZGV2L25vZGUtdmlicmFudC9zcmMvZ2VuZXJhdG9yL2RlZmF1bHQuY29mZmVlIiwiL1VzZXJzL3NpbW9uL2Rldi9ub2RlLXZpYnJhbnQvc3JjL2dlbmVyYXRvci9pbmRleC5jb2ZmZWUiLCIvVXNlcnMvc2ltb24vZGV2L25vZGUtdmlicmFudC9zcmMvaW1hZ2UvYnJvd3Nlci5jb2ZmZWUiLCIvVXNlcnMvc2ltb24vZGV2L25vZGUtdmlicmFudC9zcmMvaW1hZ2UvaW5kZXguY29mZmVlIiwiL1VzZXJzL3NpbW9uL2Rldi9ub2RlLXZpYnJhbnQvc3JjL3F1YW50aXplci9iYXNlbGluZS5jb2ZmZWUiLCIvVXNlcnMvc2ltb24vZGV2L25vZGUtdmlicmFudC9zcmMvcXVhbnRpemVyL2NvbG9yLWN1dC5jb2ZmZWUiLCIvVXNlcnMvc2ltb24vZGV2L25vZGUtdmlicmFudC9zcmMvcXVhbnRpemVyL2ltcGwvY29sb3ItY3V0LmNvZmZlZSIsIi9Vc2Vycy9zaW1vbi9kZXYvbm9kZS12aWJyYW50L3NyYy9xdWFudGl6ZXIvaW1wbC9tbWNxLmNvZmZlZSIsIi9Vc2Vycy9zaW1vbi9kZXYvbm9kZS12aWJyYW50L3NyYy9xdWFudGl6ZXIvaW1wbC9wcXVldWUuY29mZmVlIiwiL1VzZXJzL3NpbW9uL2Rldi9ub2RlLXZpYnJhbnQvc3JjL3F1YW50aXplci9pbXBsL3Zib3guY29mZmVlIiwiL1VzZXJzL3NpbW9uL2Rldi9ub2RlLXZpYnJhbnQvc3JjL3F1YW50aXplci9pbmRleC5jb2ZmZWUiLCIvVXNlcnMvc2ltb24vZGV2L25vZGUtdmlicmFudC9zcmMvcXVhbnRpemVyL21tY3EuY29mZmVlIiwiL1VzZXJzL3NpbW9uL2Rldi9ub2RlLXZpYnJhbnQvc3JjL3F1YW50aXplci9ub2NvcHkuY29mZmVlIiwiL1VzZXJzL3NpbW9uL2Rldi9ub2RlLXZpYnJhbnQvc3JjL3N3YXRjaC5jb2ZmZWUiLCIvVXNlcnMvc2ltb24vZGV2L25vZGUtdmlicmFudC9zcmMvdXRpbC5jb2ZmZWUiLCIvVXNlcnMvc2ltb24vZGV2L25vZGUtdmlicmFudC9zcmMvdmlicmFudC5jb2ZmZWUiLCJ2ZW5kb3ItbW9kL3F1YW50aXplLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ3JoQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25zQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FB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QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIi8qISBodHRwczovL210aHMuYmUvcHVueWNvZGUgdjEuNC4wIGJ5IEBtYXRoaWFzICovXG47KGZ1bmN0aW9uKHJvb3QpIHtcblxuXHQvKiogRGV0ZWN0IGZyZWUgdmFyaWFibGVzICovXG5cdHZhciBmcmVlRXhwb3J0cyA9IHR5cGVvZiBleHBvcnRzID09ICdvYmplY3QnICYmIGV4cG9ydHMgJiZcblx0XHQhZXhwb3J0cy5ub2RlVHlwZSAmJiBleHBvcnRzO1xuXHR2YXIgZnJlZU1vZHVsZSA9IHR5cGVvZiBtb2R1bGUgPT0gJ29iamVjdCcgJiYgbW9kdWxlICYmXG5cdFx0IW1vZHVsZS5ub2RlVHlwZSAmJiBtb2R1bGU7XG5cdHZhciBmcmVlR2xvYmFsID0gdHlwZW9mIGdsb2JhbCA9PSAnb2JqZWN0JyAmJiBnbG9iYWw7XG5cdGlmIChcblx0XHRmcmVlR2xvYmFsLmdsb2JhbCA9PT0gZnJlZUdsb2JhbCB8fFxuXHRcdGZyZWVHbG9iYWwud2luZG93ID09PSBmcmVlR2xvYmFsIHx8XG5cdFx0ZnJlZUdsb2JhbC5zZWxmID09PSBmcmVlR2xvYmFsXG5cdCkge1xuXHRcdHJvb3QgPSBmcmVlR2xvYmFsO1xuXHR9XG5cblx0LyoqXG5cdCAqIFRoZSBgcHVueWNvZGVgIG9iamVjdC5cblx0ICogQG5hbWUgcHVueWNvZGVcblx0ICogQHR5cGUgT2JqZWN0XG5cdCAqL1xuXHR2YXIgcHVueWNvZGUsXG5cblx0LyoqIEhpZ2hlc3QgcG9zaXRpdmUgc2lnbmVkIDMyLWJpdCBmbG9hdCB2YWx1ZSAqL1xuXHRtYXhJbnQgPSAyMTQ3NDgzNjQ3LCAvLyBha2EuIDB4N0ZGRkZGRkYgb3IgMl4zMS0xXG5cblx0LyoqIEJvb3RzdHJpbmcgcGFyYW1ldGVycyAqL1xuXHRiYXNlID0gMzYsXG5cdHRNaW4gPSAxLFxuXHR0TWF4ID0gMjYsXG5cdHNrZXcgPSAzOCxcblx0ZGFtcCA9IDcwMCxcblx0aW5pdGlhbEJpYXMgPSA3Mixcblx0aW5pdGlhbE4gPSAxMjgsIC8vIDB4ODBcblx0ZGVsaW1pdGVyID0gJy0nLCAvLyAnXFx4MkQnXG5cblx0LyoqIFJlZ3VsYXIgZXhwcmVzc2lvbnMgKi9cblx0cmVnZXhQdW55Y29kZSA9IC9eeG4tLS8sXG5cdHJlZ2V4Tm9uQVNDSUkgPSAvW15cXHgyMC1cXHg3RV0vLCAvLyB1bnByaW50YWJsZSBBU0NJSSBjaGFycyArIG5vbi1BU0NJSSBjaGFyc1xuXHRyZWdleFNlcGFyYXRvcnMgPSAvW1xceDJFXFx1MzAwMlxcdUZGMEVcXHVGRjYxXS9nLCAvLyBSRkMgMzQ5MCBzZXBhcmF0b3JzXG5cblx0LyoqIEVycm9yIG1lc3NhZ2VzICovXG5cdGVycm9ycyA9IHtcblx0XHQnb3ZlcmZsb3cnOiAnT3ZlcmZsb3c6IGlucHV0IG5lZWRzIHdpZGVyIGludGVnZXJzIHRvIHByb2Nlc3MnLFxuXHRcdCdub3QtYmFzaWMnOiAnSWxsZWdhbCBpbnB1dCA+PSAweDgwIChub3QgYSBiYXNpYyBjb2RlIHBvaW50KScsXG5cdFx0J2ludmFsaWQtaW5wdXQnOiAnSW52YWxpZCBpbnB1dCdcblx0fSxcblxuXHQvKiogQ29udmVuaWVuY2Ugc2hvcnRjdXRzICovXG5cdGJhc2VNaW51c1RNaW4gPSBiYXNlIC0gdE1pbixcblx0Zmxvb3IgPSBNYXRoLmZsb29yLFxuXHRzdHJpbmdGcm9tQ2hhckNvZGUgPSBTdHJpbmcuZnJvbUNoYXJDb2RlLFxuXG5cdC8qKiBUZW1wb3JhcnkgdmFyaWFibGUgKi9cblx0a2V5O1xuXG5cdC8qLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0qL1xuXG5cdC8qKlxuXHQgKiBBIGdlbmVyaWMgZXJyb3IgdXRpbGl0eSBmdW5jdGlvbi5cblx0ICogQHByaXZhdGVcblx0ICogQHBhcmFtIHtTdHJpbmd9IHR5cGUgVGhlIGVycm9yIHR5cGUuXG5cdCAqIEByZXR1cm5zIHtFcnJvcn0gVGhyb3dzIGEgYFJhbmdlRXJyb3JgIHdpdGggdGhlIGFwcGxpY2FibGUgZXJyb3IgbWVzc2FnZS5cblx0ICovXG5cdGZ1bmN0aW9uIGVycm9yKHR5cGUpIHtcblx0XHR0aHJvdyBuZXcgUmFuZ2VFcnJvcihlcnJvcnNbdHlwZV0pO1xuXHR9XG5cblx0LyoqXG5cdCAqIEEgZ2VuZXJpYyBgQXJyYXkjbWFwYCB1dGlsaXR5IGZ1bmN0aW9uLlxuXHQgKiBAcHJpdmF0ZVxuXHQgKiBAcGFyYW0ge0FycmF5fSBhcnJheSBUaGUgYXJyYXkgdG8gaXRlcmF0ZSBvdmVyLlxuXHQgKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFjayBUaGUgZnVuY3Rpb24gdGhhdCBnZXRzIGNhbGxlZCBmb3IgZXZlcnkgYXJyYXlcblx0ICogaXRlbS5cblx0ICogQHJldHVybnMge0FycmF5fSBBIG5ldyBhcnJheSBvZiB2YWx1ZXMgcmV0dXJuZWQgYnkgdGhlIGNhbGxiYWNrIGZ1bmN0aW9uLlxuXHQgKi9cblx0ZnVuY3Rpb24gbWFwKGFycmF5LCBmbikge1xuXHRcdHZhciBsZW5ndGggPSBhcnJheS5sZW5ndGg7XG5cdFx0dmFyIHJlc3VsdCA9IFtdO1xuXHRcdHdoaWxlIChsZW5ndGgtLSkge1xuXHRcdFx0cmVzdWx0W2xlbmd0aF0gPSBmbihhcnJheVtsZW5ndGhdKTtcblx0XHR9XG5cdFx0cmV0dXJuIHJlc3VsdDtcblx0fVxuXG5cdC8qKlxuXHQgKiBBIHNpbXBsZSBgQXJyYXkjbWFwYC1saWtlIHdyYXBwZXIgdG8gd29yayB3aXRoIGRvbWFpbiBuYW1lIHN0cmluZ3Mgb3IgZW1haWxcblx0ICogYWRkcmVzc2VzLlxuXHQgKiBAcHJpdmF0ZVxuXHQgKiBAcGFyYW0ge1N0cmluZ30gZG9tYWluIFRoZSBkb21haW4gbmFtZSBvciBlbWFpbCBhZGRyZXNzLlxuXHQgKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFjayBUaGUgZnVuY3Rpb24gdGhhdCBnZXRzIGNhbGxlZCBmb3IgZXZlcnlcblx0ICogY2hhcmFjdGVyLlxuXHQgKiBAcmV0dXJucyB7QXJyYXl9IEEgbmV3IHN0cmluZyBvZiBjaGFyYWN0ZXJzIHJldHVybmVkIGJ5IHRoZSBjYWxsYmFja1xuXHQgKiBmdW5jdGlvbi5cblx0ICovXG5cdGZ1bmN0aW9uIG1hcERvbWFpbihzdHJpbmcsIGZuKSB7XG5cdFx0dmFyIHBhcnRzID0gc3RyaW5nLnNwbGl0KCdAJyk7XG5cdFx0dmFyIHJlc3VsdCA9ICcnO1xuXHRcdGlmIChwYXJ0cy5sZW5ndGggPiAxKSB7XG5cdFx0XHQvLyBJbiBlbWFpbCBhZGRyZXNzZXMsIG9ubHkgdGhlIGRvbWFpbiBuYW1lIHNob3VsZCBiZSBwdW55Y29kZWQuIExlYXZlXG5cdFx0XHQvLyB0aGUgbG9jYWwgcGFydCAoaS5lLiBldmVyeXRoaW5nIHVwIHRvIGBAYCkgaW50YWN0LlxuXHRcdFx0cmVzdWx0ID0gcGFydHNbMF0gKyAnQCc7XG5cdFx0XHRzdHJpbmcgPSBwYXJ0c1sxXTtcblx0XHR9XG5cdFx0Ly8gQXZvaWQgYHNwbGl0KHJlZ2V4KWAgZm9yIElFOCBjb21wYXRpYmlsaXR5LiBTZWUgIzE3LlxuXHRcdHN0cmluZyA9IHN0cmluZy5yZXBsYWNlKHJlZ2V4U2VwYXJhdG9ycywgJ1xceDJFJyk7XG5cdFx0dmFyIGxhYmVscyA9IHN0cmluZy5zcGxpdCgnLicpO1xuXHRcdHZhciBlbmNvZGVkID0gbWFwKGxhYmVscywgZm4pLmpvaW4oJy4nKTtcblx0XHRyZXR1cm4gcmVzdWx0ICsgZW5jb2RlZDtcblx0fVxuXG5cdC8qKlxuXHQgKiBDcmVhdGVzIGFuIGFycmF5IGNvbnRhaW5pbmcgdGhlIG51bWVyaWMgY29kZSBwb2ludHMgb2YgZWFjaCBVbmljb2RlXG5cdCAqIGNoYXJhY3RlciBpbiB0aGUgc3RyaW5nLiBXaGlsZSBKYXZhU2NyaXB0IHVzZXMgVUNTLTIgaW50ZXJuYWxseSxcblx0ICogdGhpcyBmdW5jdGlvbiB3aWxsIGNvbnZlcnQgYSBwYWlyIG9mIHN1cnJvZ2F0ZSBoYWx2ZXMgKGVhY2ggb2Ygd2hpY2hcblx0ICogVUNTLTIgZXhwb3NlcyBhcyBzZXBhcmF0ZSBjaGFyYWN0ZXJzKSBpbnRvIGEgc2luZ2xlIGNvZGUgcG9pbnQsXG5cdCAqIG1hdGNoaW5nIFVURi0xNi5cblx0ICogQHNlZSBgcHVueWNvZGUudWNzMi5lbmNvZGVgXG5cdCAqIEBzZWUgPGh0dHBzOi8vbWF0aGlhc2J5bmVucy5iZS9ub3Rlcy9qYXZhc2NyaXB0LWVuY29kaW5nPlxuXHQgKiBAbWVtYmVyT2YgcHVueWNvZGUudWNzMlxuXHQgKiBAbmFtZSBkZWNvZGVcblx0ICogQHBhcmFtIHtTdHJpbmd9IHN0cmluZyBUaGUgVW5pY29kZSBpbnB1dCBzdHJpbmcgKFVDUy0yKS5cblx0ICogQHJldHVybnMge0FycmF5fSBUaGUgbmV3IGFycmF5IG9mIGNvZGUgcG9pbnRzLlxuXHQgKi9cblx0ZnVuY3Rpb24gdWNzMmRlY29kZShzdHJpbmcpIHtcblx0XHR2YXIgb3V0cHV0ID0gW10sXG5cdFx0ICAgIGNvdW50ZXIgPSAwLFxuXHRcdCAgICBsZW5ndGggPSBzdHJpbmcubGVuZ3RoLFxuXHRcdCAgICB2YWx1ZSxcblx0XHQgICAgZXh0cmE7XG5cdFx0d2hpbGUgKGNvdW50ZXIgPCBsZW5ndGgpIHtcblx0XHRcdHZhbHVlID0gc3RyaW5nLmNoYXJDb2RlQXQoY291bnRlcisrKTtcblx0XHRcdGlmICh2YWx1ZSA+PSAweEQ4MDAgJiYgdmFsdWUgPD0gMHhEQkZGICYmIGNvdW50ZXIgPCBsZW5ndGgpIHtcblx0XHRcdFx0Ly8gaGlnaCBzdXJyb2dhdGUsIGFuZCB0aGVyZSBpcyBhIG5leHQgY2hhcmFjdGVyXG5cdFx0XHRcdGV4dHJhID0gc3RyaW5nLmNoYXJDb2RlQXQoY291bnRlcisrKTtcblx0XHRcdFx0aWYgKChleHRyYSAmIDB4RkMwMCkgPT0gMHhEQzAwKSB7IC8vIGxvdyBzdXJyb2dhdGVcblx0XHRcdFx0XHRvdXRwdXQucHVzaCgoKHZhbHVlICYgMHgzRkYpIDw8IDEwKSArIChleHRyYSAmIDB4M0ZGKSArIDB4MTAwMDApO1xuXHRcdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRcdC8vIHVubWF0Y2hlZCBzdXJyb2dhdGU7IG9ubHkgYXBwZW5kIHRoaXMgY29kZSB1bml0LCBpbiBjYXNlIHRoZSBuZXh0XG5cdFx0XHRcdFx0Ly8gY29kZSB1bml0IGlzIHRoZSBoaWdoIHN1cnJvZ2F0ZSBvZiBhIHN1cnJvZ2F0ZSBwYWlyXG5cdFx0XHRcdFx0b3V0cHV0LnB1c2godmFsdWUpO1xuXHRcdFx0XHRcdGNvdW50ZXItLTtcblx0XHRcdFx0fVxuXHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0b3V0cHV0LnB1c2godmFsdWUpO1xuXHRcdFx0fVxuXHRcdH1cblx0XHRyZXR1cm4gb3V0cHV0O1xuXHR9XG5cblx0LyoqXG5cdCAqIENyZWF0ZXMgYSBzdHJpbmcgYmFzZWQgb24gYW4gYXJyYXkgb2YgbnVtZXJpYyBjb2RlIHBvaW50cy5cblx0ICogQHNlZSBgcHVueWNvZGUudWNzMi5kZWNvZGVgXG5cdCAqIEBtZW1iZXJPZiBwdW55Y29kZS51Y3MyXG5cdCAqIEBuYW1lIGVuY29kZVxuXHQgKiBAcGFyYW0ge0FycmF5fSBjb2RlUG9pbnRzIFRoZSBhcnJheSBvZiBudW1lcmljIGNvZGUgcG9pbnRzLlxuXHQgKiBAcmV0dXJucyB7U3RyaW5nfSBUaGUgbmV3IFVuaWNvZGUgc3RyaW5nIChVQ1MtMikuXG5cdCAqL1xuXHRmdW5jdGlvbiB1Y3MyZW5jb2RlKGFycmF5KSB7XG5cdFx0cmV0dXJuIG1hcChhcnJheSwgZnVuY3Rpb24odmFsdWUpIHtcblx0XHRcdHZhciBvdXRwdXQgPSAnJztcblx0XHRcdGlmICh2YWx1ZSA+IDB4RkZGRikge1xuXHRcdFx0XHR2YWx1ZSAtPSAweDEwMDAwO1xuXHRcdFx0XHRvdXRwdXQgKz0gc3RyaW5nRnJvbUNoYXJDb2RlKHZhbHVlID4+PiAxMCAmIDB4M0ZGIHwgMHhEODAwKTtcblx0XHRcdFx0dmFsdWUgPSAweERDMDAgfCB2YWx1ZSAmIDB4M0ZGO1xuXHRcdFx0fVxuXHRcdFx0b3V0cHV0ICs9IHN0cmluZ0Zyb21DaGFyQ29kZSh2YWx1ZSk7XG5cdFx0XHRyZXR1cm4gb3V0cHV0O1xuXHRcdH0pLmpvaW4oJycpO1xuXHR9XG5cblx0LyoqXG5cdCAqIENvbnZlcnRzIGEgYmFzaWMgY29kZSBwb2ludCBpbnRvIGEgZGlnaXQvaW50ZWdlci5cblx0ICogQHNlZSBgZGlnaXRUb0Jhc2ljKClgXG5cdCAqIEBwcml2YXRlXG5cdCAqIEBwYXJhbSB7TnVtYmVyfSBjb2RlUG9pbnQgVGhlIGJhc2ljIG51bWVyaWMgY29kZSBwb2ludCB2YWx1ZS5cblx0ICogQHJldHVybnMge051bWJlcn0gVGhlIG51bWVyaWMgdmFsdWUgb2YgYSBiYXNpYyBjb2RlIHBvaW50IChmb3IgdXNlIGluXG5cdCAqIHJlcHJlc2VudGluZyBpbnRlZ2VycykgaW4gdGhlIHJhbmdlIGAwYCB0byBgYmFzZSAtIDFgLCBvciBgYmFzZWAgaWZcblx0ICogdGhlIGNvZGUgcG9pbnQgZG9lcyBub3QgcmVwcmVzZW50IGEgdmFsdWUuXG5cdCAqL1xuXHRmdW5jdGlvbiBiYXNpY1RvRGlnaXQoY29kZVBvaW50KSB7XG5cdFx0aWYgKGNvZGVQb2ludCAtIDQ4IDwgMTApIHtcblx0XHRcdHJldHVybiBjb2RlUG9pbnQgLSAyMjtcblx0XHR9XG5cdFx0aWYgKGNvZGVQb2ludCAtIDY1IDwgMjYpIHtcblx0XHRcdHJldHVybiBjb2RlUG9pbnQgLSA2NTtcblx0XHR9XG5cdFx0aWYgKGNvZGVQb2ludCAtIDk3IDwgMjYpIHtcblx0XHRcdHJldHVybiBjb2RlUG9pbnQgLSA5Nztcblx0XHR9XG5cdFx0cmV0dXJuIGJhc2U7XG5cdH1cblxuXHQvKipcblx0ICogQ29udmVydHMgYSBkaWdpdC9pbnRlZ2VyIGludG8gYSBiYXNpYyBjb2RlIHBvaW50LlxuXHQgKiBAc2VlIGBiYXNpY1RvRGlnaXQoKWBcblx0ICogQHByaXZhdGVcblx0ICogQHBhcmFtIHtOdW1iZXJ9IGRpZ2l0IFRoZSBudW1lcmljIHZhbHVlIG9mIGEgYmFzaWMgY29kZSBwb2ludC5cblx0ICogQHJldHVybnMge051bWJlcn0gVGhlIGJhc2ljIGNvZGUgcG9pbnQgd2hvc2UgdmFsdWUgKHdoZW4gdXNlZCBmb3Jcblx0ICogcmVwcmVzZW50aW5nIGludGVnZXJzKSBpcyBgZGlnaXRgLCB3aGljaCBuZWVkcyB0byBiZSBpbiB0aGUgcmFuZ2Vcblx0ICogYDBgIHRvIGBiYXNlIC0gMWAuIElmIGBmbGFnYCBpcyBub24temVybywgdGhlIHVwcGVyY2FzZSBmb3JtIGlzXG5cdCAqIHVzZWQ7IGVsc2UsIHRoZSBsb3dlcmNhc2UgZm9ybSBpcyB1c2VkLiBUaGUgYmVoYXZpb3IgaXMgdW5kZWZpbmVkXG5cdCAqIGlmIGBmbGFnYCBpcyBub24temVybyBhbmQgYGRpZ2l0YCBoYXMgbm8gdXBwZXJjYXNlIGZvcm0uXG5cdCAqL1xuXHRmdW5jdGlvbiBkaWdpdFRvQmFzaWMoZGlnaXQsIGZsYWcpIHtcblx0XHQvLyAgMC4uMjUgbWFwIHRvIEFTQ0lJIGEuLnogb3IgQS4uWlxuXHRcdC8vIDI2Li4zNSBtYXAgdG8gQVNDSUkgMC4uOVxuXHRcdHJldHVybiBkaWdpdCArIDIyICsgNzUgKiAoZGlnaXQgPCAyNikgLSAoKGZsYWcgIT0gMCkgPDwgNSk7XG5cdH1cblxuXHQvKipcblx0ICogQmlhcyBhZGFwdGF0aW9uIGZ1bmN0aW9uIGFzIHBlciBzZWN0aW9uIDMuNCBvZiBSRkMgMzQ5Mi5cblx0ICogaHR0cHM6Ly90b29scy5pZXRmLm9yZy9odG1sL3JmYzM0OTIjc2VjdGlvbi0zLjRcblx0ICogQHByaXZhdGVcblx0ICovXG5cdGZ1bmN0aW9uIGFkYXB0KGRlbHRhLCBudW1Qb2ludHMsIGZpcnN0VGltZSkge1xuXHRcdHZhciBrID0gMDtcblx0XHRkZWx0YSA9IGZpcnN0VGltZSA/IGZsb29yKGRlbHRhIC8gZGFtcCkgOiBkZWx0YSA+PiAxO1xuXHRcdGRlbHRhICs9IGZsb29yKGRlbHRhIC8gbnVtUG9pbnRzKTtcblx0XHRmb3IgKC8qIG5vIGluaXRpYWxpemF0aW9uICovOyBkZWx0YSA+IGJhc2VNaW51c1RNaW4gKiB0TWF4ID4+IDE7IGsgKz0gYmFzZSkge1xuXHRcdFx0ZGVsdGEgPSBmbG9vcihkZWx0YSAvIGJhc2VNaW51c1RNaW4pO1xuXHRcdH1cblx0XHRyZXR1cm4gZmxvb3IoayArIChiYXNlTWludXNUTWluICsgMSkgKiBkZWx0YSAvIChkZWx0YSArIHNrZXcpKTtcblx0fVxuXG5cdC8qKlxuXHQgKiBDb252ZXJ0cyBhIFB1bnljb2RlIHN0cmluZyBvZiBBU0NJSS1vbmx5IHN5bWJvbHMgdG8gYSBzdHJpbmcgb2YgVW5pY29kZVxuXHQgKiBzeW1ib2xzLlxuXHQgKiBAbWVtYmVyT2YgcHVueWNvZGVcblx0ICogQHBhcmFtIHtTdHJpbmd9IGlucHV0IFRoZSBQdW55Y29kZSBzdHJpbmcgb2YgQVNDSUktb25seSBzeW1ib2xzLlxuXHQgKiBAcmV0dXJucyB7U3RyaW5nfSBUaGUgcmVzdWx0aW5nIHN0cmluZyBvZiBVbmljb2RlIHN5bWJvbHMuXG5cdCAqL1xuXHRmdW5jdGlvbiBkZWNvZGUoaW5wdXQpIHtcblx0XHQvLyBEb24ndCB1c2UgVUNTLTJcblx0XHR2YXIgb3V0cHV0ID0gW10sXG5cdFx0ICAgIGlucHV0TGVuZ3RoID0gaW5wdXQubGVuZ3RoLFxuXHRcdCAgICBvdXQsXG5cdFx0ICAgIGkgPSAwLFxuXHRcdCAgICBuID0gaW5pdGlhbE4sXG5cdFx0ICAgIGJpYXMgPSBpbml0aWFsQmlhcyxcblx0XHQgICAgYmFzaWMsXG5cdFx0ICAgIGosXG5cdFx0ICAgIGluZGV4LFxuXHRcdCAgICBvbGRpLFxuXHRcdCAgICB3LFxuXHRcdCAgICBrLFxuXHRcdCAgICBkaWdpdCxcblx0XHQgICAgdCxcblx0XHQgICAgLyoqIENhY2hlZCBjYWxjdWxhdGlvbiByZXN1bHRzICovXG5cdFx0ICAgIGJhc2VNaW51c1Q7XG5cblx0XHQvLyBIYW5kbGUgdGhlIGJhc2ljIGNvZGUgcG9pbnRzOiBsZXQgYGJhc2ljYCBiZSB0aGUgbnVtYmVyIG9mIGlucHV0IGNvZGVcblx0XHQvLyBwb2ludHMgYmVmb3JlIHRoZSBsYXN0IGRlbGltaXRlciwgb3IgYDBgIGlmIHRoZXJlIGlzIG5vbmUsIHRoZW4gY29weVxuXHRcdC8vIHRoZSBmaXJzdCBiYXNpYyBjb2RlIHBvaW50cyB0byB0aGUgb3V0cHV0LlxuXG5cdFx0YmFzaWMgPSBpbnB1dC5sYXN0SW5kZXhPZihkZWxpbWl0ZXIpO1xuXHRcdGlmIChiYXNpYyA8IDApIHtcblx0XHRcdGJhc2ljID0gMDtcblx0XHR9XG5cblx0XHRmb3IgKGogPSAwOyBqIDwgYmFzaWM7ICsraikge1xuXHRcdFx0Ly8gaWYgaXQncyBub3QgYSBiYXNpYyBjb2RlIHBvaW50XG5cdFx0XHRpZiAoaW5wdXQuY2hhckNvZGVBdChqKSA+PSAweDgwKSB7XG5cdFx0XHRcdGVycm9yKCdub3QtYmFzaWMnKTtcblx0XHRcdH1cblx0XHRcdG91dHB1dC5wdXNoKGlucHV0LmNoYXJDb2RlQXQoaikpO1xuXHRcdH1cblxuXHRcdC8vIE1haW4gZGVjb2RpbmcgbG9vcDogc3RhcnQganVzdCBhZnRlciB0aGUgbGFzdCBkZWxpbWl0ZXIgaWYgYW55IGJhc2ljIGNvZGVcblx0XHQvLyBwb2ludHMgd2VyZSBjb3BpZWQ7IHN0YXJ0IGF0IHRoZSBiZWdpbm5pbmcgb3RoZXJ3aXNlLlxuXG5cdFx0Zm9yIChpbmRleCA9IGJhc2ljID4gMCA/IGJhc2ljICsgMSA6IDA7IGluZGV4IDwgaW5wdXRMZW5ndGg7IC8qIG5vIGZpbmFsIGV4cHJlc3Npb24gKi8pIHtcblxuXHRcdFx0Ly8gYGluZGV4YCBpcyB0aGUgaW5kZXggb2YgdGhlIG5leHQgY2hhcmFjdGVyIHRvIGJlIGNvbnN1bWVkLlxuXHRcdFx0Ly8gRGVjb2RlIGEgZ2VuZXJhbGl6ZWQgdmFyaWFibGUtbGVuZ3RoIGludGVnZXIgaW50byBgZGVsdGFgLFxuXHRcdFx0Ly8gd2hpY2ggZ2V0cyBhZGRlZCB0byBgaWAuIFRoZSBvdmVyZmxvdyBjaGVja2luZyBpcyBlYXNpZXJcblx0XHRcdC8vIGlmIHdlIGluY3JlYXNlIGBpYCBhcyB3ZSBnbywgdGhlbiBzdWJ0cmFjdCBvZmYgaXRzIHN0YXJ0aW5nXG5cdFx0XHQvLyB2YWx1ZSBhdCB0aGUgZW5kIHRvIG9idGFpbiBgZGVsdGFgLlxuXHRcdFx0Zm9yIChvbGRpID0gaSwgdyA9IDEsIGsgPSBiYXNlOyAvKiBubyBjb25kaXRpb24gKi87IGsgKz0gYmFzZSkge1xuXG5cdFx0XHRcdGlmIChpbmRleCA+PSBpbnB1dExlbmd0aCkge1xuXHRcdFx0XHRcdGVycm9yKCdpbnZhbGlkLWlucHV0Jyk7XG5cdFx0XHRcdH1cblxuXHRcdFx0XHRkaWdpdCA9IGJhc2ljVG9EaWdpdChpbnB1dC5jaGFyQ29kZUF0KGluZGV4KyspKTtcblxuXHRcdFx0XHRpZiAoZGlnaXQgPj0gYmFzZSB8fCBkaWdpdCA+IGZsb29yKChtYXhJbnQgLSBpKSAvIHcpKSB7XG5cdFx0XHRcdFx0ZXJyb3IoJ292ZXJmbG93Jyk7XG5cdFx0XHRcdH1cblxuXHRcdFx0XHRpICs9IGRpZ2l0ICogdztcblx0XHRcdFx0dCA9IGsgPD0gYmlhcyA/IHRNaW4gOiAoayA+PSBiaWFzICsgdE1heCA/IHRNYXggOiBrIC0gYmlhcyk7XG5cblx0XHRcdFx0aWYgKGRpZ2l0IDwgdCkge1xuXHRcdFx0XHRcdGJyZWFrO1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0YmFzZU1pbnVzVCA9IGJhc2UgLSB0O1xuXHRcdFx0XHRpZiAodyA+IGZsb29yKG1heEludCAvIGJhc2VNaW51c1QpKSB7XG5cdFx0XHRcdFx0ZXJyb3IoJ292ZXJmbG93Jyk7XG5cdFx0XHRcdH1cblxuXHRcdFx0XHR3ICo9IGJhc2VNaW51c1Q7XG5cblx0XHRcdH1cblxuXHRcdFx0b3V0ID0gb3V0cHV0Lmxlbmd0aCArIDE7XG5cdFx0XHRiaWFzID0gYWRhcHQoaSAtIG9sZGksIG91dCwgb2xkaSA9PSAwKTtcblxuXHRcdFx0Ly8gYGlgIHdhcyBzdXBwb3NlZCB0byB3cmFwIGFyb3VuZCBmcm9tIGBvdXRgIHRvIGAwYCxcblx0XHRcdC8vIGluY3JlbWVudGluZyBgbmAgZWFjaCB0aW1lLCBzbyB3ZSdsbCBmaXggdGhhdCBub3c6XG5cdFx0XHRpZiAoZmxvb3IoaSAvIG91dCkgPiBtYXhJbnQgLSBuKSB7XG5cdFx0XHRcdGVycm9yKCdvdmVyZmxvdycpO1xuXHRcdFx0fVxuXG5cdFx0XHRuICs9IGZsb29yKGkgLyBvdXQpO1xuXHRcdFx0aSAlPSBvdXQ7XG5cblx0XHRcdC8vIEluc2VydCBgbmAgYXQgcG9zaXRpb24gYGlgIG9mIHRoZSBvdXRwdXRcblx0XHRcdG91dHB1dC5zcGxpY2UoaSsrLCAwLCBuKTtcblxuXHRcdH1cblxuXHRcdHJldHVybiB1Y3MyZW5jb2RlKG91dHB1dCk7XG5cdH1cblxuXHQvKipcblx0ICogQ29udmVydHMgYSBzdHJpbmcgb2YgVW5pY29kZSBzeW1ib2xzIChlLmcuIGEgZG9tYWluIG5hbWUgbGFiZWwpIHRvIGFcblx0ICogUHVueWNvZGUgc3RyaW5nIG9mIEFTQ0lJLW9ubHkgc3ltYm9scy5cblx0ICogQG1lbWJlck9mIHB1bnljb2RlXG5cdCAqIEBwYXJhbSB7U3RyaW5nfSBpbnB1dCBUaGUgc3RyaW5nIG9mIFVuaWNvZGUgc3ltYm9scy5cblx0ICogQHJldHVybnMge1N0cmluZ30gVGhlIHJlc3VsdGluZyBQdW55Y29kZSBzdHJpbmcgb2YgQVNDSUktb25seSBzeW1ib2xzLlxuXHQgKi9cblx0ZnVuY3Rpb24gZW5jb2RlKGlucHV0KSB7XG5cdFx0dmFyIG4sXG5cdFx0ICAgIGRlbHRhLFxuXHRcdCAgICBoYW5kbGVkQ1BDb3VudCxcblx0XHQgICAgYmFzaWNMZW5ndGgsXG5cdFx0ICAgIGJpYXMsXG5cdFx0ICAgIGosXG5cdFx0ICAgIG0sXG5cdFx0ICAgIHEsXG5cdFx0ICAgIGssXG5cdFx0ICAgIHQsXG5cdFx0ICAgIGN1cnJlbnRWYWx1ZSxcblx0XHQgICAgb3V0cHV0ID0gW10sXG5cdFx0ICAgIC8qKiBgaW5wdXRMZW5ndGhgIHdpbGwgaG9sZCB0aGUgbnVtYmVyIG9mIGNvZGUgcG9pbnRzIGluIGBpbnB1dGAuICovXG5cdFx0ICAgIGlucHV0TGVuZ3RoLFxuXHRcdCAgICAvKiogQ2FjaGVkIGNhbGN1bGF0aW9uIHJlc3VsdHMgKi9cblx0XHQgICAgaGFuZGxlZENQQ291bnRQbHVzT25lLFxuXHRcdCAgICBiYXNlTWludXNULFxuXHRcdCAgICBxTWludXNUO1xuXG5cdFx0Ly8gQ29udmVydCB0aGUgaW5wdXQgaW4gVUNTLTIgdG8gVW5pY29kZVxuXHRcdGlucHV0ID0gdWNzMmRlY29kZShpbnB1dCk7XG5cblx0XHQvLyBDYWNoZSB0aGUgbGVuZ3RoXG5cdFx0aW5wdXRMZW5ndGggPSBpbnB1dC5sZW5ndGg7XG5cblx0XHQvLyBJbml0aWFsaXplIHRoZSBzdGF0ZVxuXHRcdG4gPSBpbml0aWFsTjtcblx0XHRkZWx0YSA9IDA7XG5cdFx0YmlhcyA9IGluaXRpYWxCaWFzO1xuXG5cdFx0Ly8gSGFuZGxlIHRoZSBiYXNpYyBjb2RlIHBvaW50c1xuXHRcdGZvciAoaiA9IDA7IGogPCBpbnB1dExlbmd0aDsgKytqKSB7XG5cdFx0XHRjdXJyZW50VmFsdWUgPSBpbnB1dFtqXTtcblx0XHRcdGlmIChjdXJyZW50VmFsdWUgPCAweDgwKSB7XG5cdFx0XHRcdG91dHB1dC5wdXNoKHN0cmluZ0Zyb21DaGFyQ29kZShjdXJyZW50VmFsdWUpKTtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRoYW5kbGVkQ1BDb3VudCA9IGJhc2ljTGVuZ3RoID0gb3V0cHV0Lmxlbmd0aDtcblxuXHRcdC8vIGBoYW5kbGVkQ1BDb3VudGAgaXMgdGhlIG51bWJlciBvZiBjb2RlIHBvaW50cyB0aGF0IGhhdmUgYmVlbiBoYW5kbGVkO1xuXHRcdC8vIGBiYXNpY0xlbmd0aGAgaXMgdGhlIG51bWJlciBvZiBiYXNpYyBjb2RlIHBvaW50cy5cblxuXHRcdC8vIEZpbmlzaCB0aGUgYmFzaWMgc3RyaW5nIC0gaWYgaXQgaXMgbm90IGVtcHR5IC0gd2l0aCBhIGRlbGltaXRlclxuXHRcdGlmIChiYXNpY0xlbmd0aCkge1xuXHRcdFx0b3V0cHV0LnB1c2goZGVsaW1pdGVyKTtcblx0XHR9XG5cblx0XHQvLyBNYWluIGVuY29kaW5nIGxvb3A6XG5cdFx0d2hpbGUgKGhhbmRsZWRDUENvdW50IDwgaW5wdXRMZW5ndGgpIHtcblxuXHRcdFx0Ly8gQWxsIG5vbi1iYXNpYyBjb2RlIHBvaW50cyA8IG4gaGF2ZSBiZWVuIGhhbmRsZWQgYWxyZWFkeS4gRmluZCB0aGUgbmV4dFxuXHRcdFx0Ly8gbGFyZ2VyIG9uZTpcblx0XHRcdGZvciAobSA9IG1heEludCwgaiA9IDA7IGogPCBpbnB1dExlbmd0aDsgKytqKSB7XG5cdFx0XHRcdGN1cnJlbnRWYWx1ZSA9IGlucHV0W2pdO1xuXHRcdFx0XHRpZiAoY3VycmVudFZhbHVlID49IG4gJiYgY3VycmVudFZhbHVlIDwgbSkge1xuXHRcdFx0XHRcdG0gPSBjdXJyZW50VmFsdWU7XG5cdFx0XHRcdH1cblx0XHRcdH1cblxuXHRcdFx0Ly8gSW5jcmVhc2UgYGRlbHRhYCBlbm91Z2ggdG8gYWR2YW5jZSB0aGUgZGVjb2RlcidzIDxuLGk+IHN0YXRlIHRvIDxtLDA+LFxuXHRcdFx0Ly8gYnV0IGd1YXJkIGFnYWluc3Qgb3ZlcmZsb3dcblx0XHRcdGhhbmRsZWRDUENvdW50UGx1c09uZSA9IGhhbmRsZWRDUENvdW50ICsgMTtcblx0XHRcdGlmIChtIC0gbiA+IGZsb29yKChtYXhJbnQgLSBkZWx0YSkgLyBoYW5kbGVkQ1BDb3VudFBsdXNPbmUpKSB7XG5cdFx0XHRcdGVycm9yKCdvdmVyZmxvdycpO1xuXHRcdFx0fVxuXG5cdFx0XHRkZWx0YSArPSAobSAtIG4pICogaGFuZGxlZENQQ291bnRQbHVzT25lO1xuXHRcdFx0biA9IG07XG5cblx0XHRcdGZvciAoaiA9IDA7IGogPCBpbnB1dExlbmd0aDsgKytqKSB7XG5cdFx0XHRcdGN1cnJlbnRWYWx1ZSA9IGlucHV0W2pdO1xuXG5cdFx0XHRcdGlmIChjdXJyZW50VmFsdWUgPCBuICYmICsrZGVsdGEgPiBtYXhJbnQpIHtcblx0XHRcdFx0XHRlcnJvcignb3ZlcmZsb3cnKTtcblx0XHRcdFx0fVxuXG5cdFx0XHRcdGlmIChjdXJyZW50VmFsdWUgPT0gbikge1xuXHRcdFx0XHRcdC8vIFJlcHJlc2VudCBkZWx0YSBhcyBhIGdlbmVyYWxpemVkIHZhcmlhYmxlLWxlbmd0aCBpbnRlZ2VyXG5cdFx0XHRcdFx0Zm9yIChxID0gZGVsdGEsIGsgPSBiYXNlOyAvKiBubyBjb25kaXRpb24gKi87IGsgKz0gYmFzZSkge1xuXHRcdFx0XHRcdFx0dCA9IGsgPD0gYmlhcyA/IHRNaW4gOiAoayA+PSBiaWFzICsgdE1heCA/IHRNYXggOiBrIC0gYmlhcyk7XG5cdFx0XHRcdFx0XHRpZiAocSA8IHQpIHtcblx0XHRcdFx0XHRcdFx0YnJlYWs7XG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHRxTWludXNUID0gcSAtIHQ7XG5cdFx0XHRcdFx0XHRiYXNlTWludXNUID0gYmFzZSAtIHQ7XG5cdFx0XHRcdFx0XHRvdXRwdXQucHVzaChcblx0XHRcdFx0XHRcdFx0c3RyaW5nRnJvbUNoYXJDb2RlKGRpZ2l0VG9CYXNpYyh0ICsgcU1pbnVzVCAlIGJhc2VNaW51c1QsIDApKVxuXHRcdFx0XHRcdFx0KTtcblx0XHRcdFx0XHRcdHEgPSBmbG9vcihxTWludXNUIC8gYmFzZU1pbnVzVCk7XG5cdFx0XHRcdFx0fVxuXG5cdFx0XHRcdFx0b3V0cHV0LnB1c2goc3RyaW5nRnJvbUNoYXJDb2RlKGRpZ2l0VG9CYXNpYyhxLCAwKSkpO1xuXHRcdFx0XHRcdGJpYXMgPSBhZGFwdChkZWx0YSwgaGFuZGxlZENQQ291bnRQbHVzT25lLCBoYW5kbGVkQ1BDb3VudCA9PSBiYXNpY0xlbmd0aCk7XG5cdFx0XHRcdFx0ZGVsdGEgPSAwO1xuXHRcdFx0XHRcdCsraGFuZGxlZENQQ291bnQ7XG5cdFx0XHRcdH1cblx0XHRcdH1cblxuXHRcdFx0KytkZWx0YTtcblx0XHRcdCsrbjtcblxuXHRcdH1cblx0XHRyZXR1cm4gb3V0cHV0LmpvaW4oJycpO1xuXHR9XG5cblx0LyoqXG5cdCAqIENvbnZlcnRzIGEgUHVueWNvZGUgc3RyaW5nIHJlcHJlc2VudGluZyBhIGRvbWFpbiBuYW1lIG9yIGFuIGVtYWlsIGFkZHJlc3Ncblx0ICogdG8gVW5pY29kZS4gT25seSB0aGUgUHVueWNvZGVkIHBhcnRzIG9mIHRoZSBpbnB1dCB3aWxsIGJlIGNvbnZlcnRlZCwgaS5lLlxuXHQgKiBpdCBkb2Vzbid0IG1hdHRlciBpZiB5b3UgY2FsbCBpdCBvbiBhIHN0cmluZyB0aGF0IGhhcyBhbHJlYWR5IGJlZW5cblx0ICogY29udmVydGVkIHRvIFVuaWNvZGUuXG5cdCAqIEBtZW1iZXJPZiBwdW55Y29kZVxuXHQgKiBAcGFyYW0ge1N0cmluZ30gaW5wdXQgVGhlIFB1bnljb2RlZCBkb21haW4gbmFtZSBvciBlbWFpbCBhZGRyZXNzIHRvXG5cdCAqIGNvbnZlcnQgdG8gVW5pY29kZS5cblx0ICogQHJldHVybnMge1N0cmluZ30gVGhlIFVuaWNvZGUgcmVwcmVzZW50YXRpb24gb2YgdGhlIGdpdmVuIFB1bnljb2RlXG5cdCAqIHN0cmluZy5cblx0ICovXG5cdGZ1bmN0aW9uIHRvVW5pY29kZShpbnB1dCkge1xuXHRcdHJldHVybiBtYXBEb21haW4oaW5wdXQsIGZ1bmN0aW9uKHN0cmluZykge1xuXHRcdFx0cmV0dXJuIHJlZ2V4UHVueWNvZGUudGVzdChzdHJpbmcpXG5cdFx0XHRcdD8gZGVjb2RlKHN0cmluZy5zbGljZSg0KS50b0xvd2VyQ2FzZSgpKVxuXHRcdFx0XHQ6IHN0cmluZztcblx0XHR9KTtcblx0fVxuXG5cdC8qKlxuXHQgKiBDb252ZXJ0cyBhIFVuaWNvZGUgc3RyaW5nIHJlcHJlc2VudGluZyBhIGRvbWFpbiBuYW1lIG9yIGFuIGVtYWlsIGFkZHJlc3MgdG9cblx0ICogUHVueWNvZGUuIE9ubHkgdGhlIG5vbi1BU0NJSSBwYXJ0cyBvZiB0aGUgZG9tYWluIG5hbWUgd2lsbCBiZSBjb252ZXJ0ZWQsXG5cdCAqIGkuZS4gaXQgZG9lc24ndCBtYXR0ZXIgaWYgeW91IGNhbGwgaXQgd2l0aCBhIGRvbWFpbiB0aGF0J3MgYWxyZWFkeSBpblxuXHQgKiBBU0NJSS5cblx0ICogQG1lbWJlck9mIHB1bnljb2RlXG5cdCAqIEBwYXJhbSB7U3RyaW5nfSBpbnB1dCBUaGUgZG9tYWluIG5hbWUgb3IgZW1haWwgYWRkcmVzcyB0byBjb252ZXJ0LCBhcyBhXG5cdCAqIFVuaWNvZGUgc3RyaW5nLlxuXHQgKiBAcmV0dXJucyB7U3RyaW5nfSBUaGUgUHVueWNvZGUgcmVwcmVzZW50YXRpb24gb2YgdGhlIGdpdmVuIGRvbWFpbiBuYW1lIG9yXG5cdCAqIGVtYWlsIGFkZHJlc3MuXG5cdCAqL1xuXHRmdW5jdGlvbiB0b0FTQ0lJKGlucHV0KSB7XG5cdFx0cmV0dXJuIG1hcERvbWFpbihpbnB1dCwgZnVuY3Rpb24oc3RyaW5nKSB7XG5cdFx0XHRyZXR1cm4gcmVnZXhOb25BU0NJSS50ZXN0KHN0cmluZylcblx0XHRcdFx0PyAneG4tLScgKyBlbmNvZGUoc3RyaW5nKVxuXHRcdFx0XHQ6IHN0cmluZztcblx0XHR9KTtcblx0fVxuXG5cdC8qLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0qL1xuXG5cdC8qKiBEZWZpbmUgdGhlIHB1YmxpYyBBUEkgKi9cblx0cHVueWNvZGUgPSB7XG5cdFx0LyoqXG5cdFx0ICogQSBzdHJpbmcgcmVwcmVzZW50aW5nIHRoZSBjdXJyZW50IFB1bnljb2RlLmpzIHZlcnNpb24gbnVtYmVyLlxuXHRcdCAqIEBtZW1iZXJPZiBwdW55Y29kZVxuXHRcdCAqIEB0eXBlIFN0cmluZ1xuXHRcdCAqL1xuXHRcdCd2ZXJzaW9uJzogJzEuMy4yJyxcblx0XHQvKipcblx0XHQgKiBBbiBvYmplY3Qgb2YgbWV0aG9kcyB0byBjb252ZXJ0IGZyb20gSmF2YVNjcmlwdCdzIGludGVybmFsIGNoYXJhY3RlclxuXHRcdCAqIHJlcHJlc2VudGF0aW9uIChVQ1MtMikgdG8gVW5pY29kZSBjb2RlIHBvaW50cywgYW5kIGJhY2suXG5cdFx0ICogQHNlZSA8aHR0cHM6Ly9tYXRoaWFzYnluZW5zLmJlL25vdGVzL2phdmFzY3JpcHQtZW5jb2Rpbmc+XG5cdFx0ICogQG1lbWJlck9mIHB1bnljb2RlXG5cdFx0ICogQHR5cGUgT2JqZWN0XG5cdFx0ICovXG5cdFx0J3VjczInOiB7XG5cdFx0XHQnZGVjb2RlJzogdWNzMmRlY29kZSxcblx0XHRcdCdlbmNvZGUnOiB1Y3MyZW5jb2RlXG5cdFx0fSxcblx0XHQnZGVjb2RlJzogZGVjb2RlLFxuXHRcdCdlbmNvZGUnOiBlbmNvZGUsXG5cdFx0J3RvQVNDSUknOiB0b0FTQ0lJLFxuXHRcdCd0b1VuaWNvZGUnOiB0b1VuaWNvZGVcblx0fTtcblxuXHQvKiogRXhwb3NlIGBwdW55Y29kZWAgKi9cblx0Ly8gU29tZSBBTUQgYnVpbGQgb3B0aW1pemVycywgbGlrZSByLmpzLCBjaGVjayBmb3Igc3BlY2lmaWMgY29uZGl0aW9uIHBhdHRlcm5zXG5cdC8vIGxpa2UgdGhlIGZvbGxvd2luZzpcblx0aWYgKFxuXHRcdHR5cGVvZiBkZWZpbmUgPT0gJ2Z1bmN0aW9uJyAmJlxuXHRcdHR5cGVvZiBkZWZpbmUuYW1kID09ICdvYmplY3QnICYmXG5cdFx0ZGVmaW5lLmFtZFxuXHQpIHtcblx0XHRkZWZpbmUoJ3B1bnljb2RlJywgZnVuY3Rpb24oKSB7XG5cdFx0XHRyZXR1cm4gcHVueWNvZGU7XG5cdFx0fSk7XG5cdH0gZWxzZSBpZiAoZnJlZUV4cG9ydHMgJiYgZnJlZU1vZHVsZSkge1xuXHRcdGlmIChtb2R1bGUuZXhwb3J0cyA9PSBmcmVlRXhwb3J0cykge1xuXHRcdFx0Ly8gaW4gTm9kZS5qcywgaW8uanMsIG9yIFJpbmdvSlMgdjAuOC4wK1xuXHRcdFx0ZnJlZU1vZHVsZS5leHBvcnRzID0gcHVueWNvZGU7XG5cdFx0fSBlbHNlIHtcblx0XHRcdC8vIGluIE5hcndoYWwgb3IgUmluZ29KUyB2MC43LjAtXG5cdFx0XHRmb3IgKGtleSBpbiBwdW55Y29kZSkge1xuXHRcdFx0XHRwdW55Y29kZS5oYXNPd25Qcm9wZXJ0eShrZXkpICYmIChmcmVlRXhwb3J0c1trZXldID0gcHVueWNvZGVba2V5XSk7XG5cdFx0XHR9XG5cdFx0fVxuXHR9IGVsc2Uge1xuXHRcdC8vIGluIFJoaW5vIG9yIGEgd2ViIGJyb3dzZXJcblx0XHRyb290LnB1bnljb2RlID0gcHVueWNvZGU7XG5cdH1cblxufSh0aGlzKSk7XG4iLCIvLyBDb3B5cmlnaHQgSm95ZW50LCBJbmMuIGFuZCBvdGhlciBOb2RlIGNvbnRyaWJ1dG9ycy5cbi8vXG4vLyBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYVxuLy8gY29weSBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZVxuLy8gXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbCBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nXG4vLyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0cyB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsXG4vLyBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbCBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0XG4vLyBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGVcbi8vIGZvbGxvd2luZyBjb25kaXRpb25zOlxuLy9cbi8vIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkXG4vLyBpbiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbi8vXG4vLyBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTXG4vLyBPUiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GXG4vLyBNRVJDSEFOVEFCSUxJVFksIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOXG4vLyBOTyBFVkVOVCBTSEFMTCBUSEUgQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSxcbi8vIERBTUFHRVMgT1IgT1RIRVIgTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUlxuLy8gT1RIRVJXSVNFLCBBUklTSU5HIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRVxuLy8gVVNFIE9SIE9USEVSIERFQUxJTkdTIElOIFRIRSBTT0ZUV0FSRS5cblxuJ3VzZSBzdHJpY3QnO1xuXG4vLyBJZiBvYmouaGFzT3duUHJvcGVydHkgaGFzIGJlZW4gb3ZlcnJpZGRlbiwgdGhlbiBjYWxsaW5nXG4vLyBvYmouaGFzT3duUHJvcGVydHkocHJvcCkgd2lsbCBicmVhay5cbi8vIFNlZTogaHR0cHM6Ly9naXRodWIuY29tL2pveWVudC9ub2RlL2lzc3Vlcy8xNzA3XG5mdW5jdGlvbiBoYXNPd25Qcm9wZXJ0eShvYmosIHByb3ApIHtcbiAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChvYmosIHByb3ApO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKHFzLCBzZXAsIGVxLCBvcHRpb25zKSB7XG4gIHNlcCA9IHNlcCB8fCAnJic7XG4gIGVxID0gZXEgfHwgJz0nO1xuICB2YXIgb2JqID0ge307XG5cbiAgaWYgKHR5cGVvZiBxcyAhPT0gJ3N0cmluZycgfHwgcXMubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIG9iajtcbiAgfVxuXG4gIHZhciByZWdleHAgPSAvXFwrL2c7XG4gIHFzID0gcXMuc3BsaXQoc2VwKTtcblxuICB2YXIgbWF4S2V5cyA9IDEwMDA7XG4gIGlmIChvcHRpb25zICYmIHR5cGVvZiBvcHRpb25zLm1heEtleXMgPT09ICdudW1iZXInKSB7XG4gICAgbWF4S2V5cyA9IG9wdGlvbnMubWF4S2V5cztcbiAgfVxuXG4gIHZhciBsZW4gPSBxcy5sZW5ndGg7XG4gIC8vIG1heEtleXMgPD0gMCBtZWFucyB0aGF0IHdlIHNob3VsZCBub3QgbGltaXQga2V5cyBjb3VudFxuICBpZiAobWF4S2V5cyA+IDAgJiYgbGVuID4gbWF4S2V5cykge1xuICAgIGxlbiA9IG1heEtleXM7XG4gIH1cblxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgKytpKSB7XG4gICAgdmFyIHggPSBxc1tpXS5yZXBsYWNlKHJlZ2V4cCwgJyUyMCcpLFxuICAgICAgICBpZHggPSB4LmluZGV4T2YoZXEpLFxuICAgICAgICBrc3RyLCB2c3RyLCBrLCB2O1xuXG4gICAgaWYgKGlkeCA+PSAwKSB7XG4gICAgICBrc3RyID0geC5zdWJzdHIoMCwgaWR4KTtcbiAgICAgIHZzdHIgPSB4LnN1YnN0cihpZHggKyAxKTtcbiAgICB9IGVsc2Uge1xuICAgICAga3N0ciA9IHg7XG4gICAgICB2c3RyID0gJyc7XG4gICAgfVxuXG4gICAgayA9IGRlY29kZVVSSUNvbXBvbmVudChrc3RyKTtcbiAgICB2ID0gZGVjb2RlVVJJQ29tcG9uZW50KHZzdHIpO1xuXG4gICAgaWYgKCFoYXNPd25Qcm9wZXJ0eShvYmosIGspKSB7XG4gICAgICBvYmpba10gPSB2O1xuICAgIH0gZWxzZSBpZiAoaXNBcnJheShvYmpba10pKSB7XG4gICAgICBvYmpba10ucHVzaCh2KTtcbiAgICB9IGVsc2Uge1xuICAgICAgb2JqW2tdID0gW29ialtrXSwgdl07XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG9iajtcbn07XG5cbnZhciBpc0FycmF5ID0gQXJyYXkuaXNBcnJheSB8fCBmdW5jdGlvbiAoeHMpIHtcbiAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbCh4cykgPT09ICdbb2JqZWN0IEFycmF5XSc7XG59O1xuIiwiLy8gQ29weXJpZ2h0IEpveWVudCwgSW5jLiBhbmQgb3RoZXIgTm9kZSBjb250cmlidXRvcnMuXG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGFcbi8vIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGVcbi8vIFwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZ1xuLy8gd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLFxuLy8gZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdFxuLy8gcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlXG4vLyBmb2xsb3dpbmcgY29uZGl0aW9uczpcbi8vXG4vLyBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZFxuLy8gaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4vL1xuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTU1xuLy8gT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRlxuLy8gTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTlxuLy8gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sXG4vLyBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1Jcbi8vIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEVcbi8vIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXG5cbid1c2Ugc3RyaWN0JztcblxudmFyIHN0cmluZ2lmeVByaW1pdGl2ZSA9IGZ1bmN0aW9uKHYpIHtcbiAgc3dpdGNoICh0eXBlb2Ygdikge1xuICAgIGNhc2UgJ3N0cmluZyc6XG4gICAgICByZXR1cm4gdjtcblxuICAgIGNhc2UgJ2Jvb2xlYW4nOlxuICAgICAgcmV0dXJuIHYgPyAndHJ1ZScgOiAnZmFsc2UnO1xuXG4gICAgY2FzZSAnbnVtYmVyJzpcbiAgICAgIHJldHVybiBpc0Zpbml0ZSh2KSA/IHYgOiAnJztcblxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gJyc7XG4gIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24ob2JqLCBzZXAsIGVxLCBuYW1lKSB7XG4gIHNlcCA9IHNlcCB8fCAnJic7XG4gIGVxID0gZXEgfHwgJz0nO1xuICBpZiAob2JqID09PSBudWxsKSB7XG4gICAgb2JqID0gdW5kZWZpbmVkO1xuICB9XG5cbiAgaWYgKHR5cGVvZiBvYmogPT09ICdvYmplY3QnKSB7XG4gICAgcmV0dXJuIG1hcChvYmplY3RLZXlzKG9iaiksIGZ1bmN0aW9uKGspIHtcbiAgICAgIHZhciBrcyA9IGVuY29kZVVSSUNvbXBvbmVudChzdHJpbmdpZnlQcmltaXRpdmUoaykpICsgZXE7XG4gICAgICBpZiAoaXNBcnJheShvYmpba10pKSB7XG4gICAgICAgIHJldHVybiBtYXAob2JqW2tdLCBmdW5jdGlvbih2KSB7XG4gICAgICAgICAgcmV0dXJuIGtzICsgZW5jb2RlVVJJQ29tcG9uZW50KHN0cmluZ2lmeVByaW1pdGl2ZSh2KSk7XG4gICAgICAgIH0pLmpvaW4oc2VwKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBrcyArIGVuY29kZVVSSUNvbXBvbmVudChzdHJpbmdpZnlQcmltaXRpdmUob2JqW2tdKSk7XG4gICAgICB9XG4gICAgfSkuam9pbihzZXApO1xuXG4gIH1cblxuICBpZiAoIW5hbWUpIHJldHVybiAnJztcbiAgcmV0dXJuIGVuY29kZVVSSUNvbXBvbmVudChzdHJpbmdpZnlQcmltaXRpdmUobmFtZSkpICsgZXEgK1xuICAgICAgICAgZW5jb2RlVVJJQ29tcG9uZW50KHN0cmluZ2lmeVByaW1pdGl2ZShvYmopKTtcbn07XG5cbnZhciBpc0FycmF5ID0gQXJyYXkuaXNBcnJheSB8fCBmdW5jdGlvbiAoeHMpIHtcbiAgcmV0dXJuIE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbCh4cykgPT09ICdbb2JqZWN0IEFycmF5XSc7XG59O1xuXG5mdW5jdGlvbiBtYXAgKHhzLCBmKSB7XG4gIGlmICh4cy5tYXApIHJldHVybiB4cy5tYXAoZik7XG4gIHZhciByZXMgPSBbXTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB4cy5sZW5ndGg7IGkrKykge1xuICAgIHJlcy5wdXNoKGYoeHNbaV0sIGkpKTtcbiAgfVxuICByZXR1cm4gcmVzO1xufVxuXG52YXIgb2JqZWN0S2V5cyA9IE9iamVjdC5rZXlzIHx8IGZ1bmN0aW9uIChvYmopIHtcbiAgdmFyIHJlcyA9IFtdO1xuICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChvYmosIGtleSkpIHJlcy5wdXNoKGtleSk7XG4gIH1cbiAgcmV0dXJuIHJlcztcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbmV4cG9ydHMuZGVjb2RlID0gZXhwb3J0cy5wYXJzZSA9IHJlcXVpcmUoJy4vZGVjb2RlJyk7XG5leHBvcnRzLmVuY29kZSA9IGV4cG9ydHMuc3RyaW5naWZ5ID0gcmVxdWlyZSgnLi9lbmNvZGUnKTtcbiIsIi8vIENvcHlyaWdodCBKb3llbnQsIEluYy4gYW5kIG90aGVyIE5vZGUgY29udHJpYnV0b3JzLlxuLy9cbi8vIFBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhXG4vLyBjb3B5IG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlXG4vLyBcIlNvZnR3YXJlXCIpLCB0byBkZWFsIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmdcbi8vIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCxcbi8vIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXRcbi8vIHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXMgZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZVxuLy8gZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4vL1xuLy8gVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWRcbi8vIGluIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuLy9cbi8vIFRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1Ncbi8vIE9SIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0Zcbi8vIE1FUkNIQU5UQUJJTElUWSwgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU5cbi8vIE5PIEVWRU5UIFNIQUxMIFRIRSBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLFxuLy8gREFNQUdFUyBPUiBPVEhFUiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SXG4vLyBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSwgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFXG4vLyBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU4gVEhFIFNPRlRXQVJFLlxuXG52YXIgcHVueWNvZGUgPSByZXF1aXJlKCdwdW55Y29kZScpO1xuXG5leHBvcnRzLnBhcnNlID0gdXJsUGFyc2U7XG5leHBvcnRzLnJlc29sdmUgPSB1cmxSZXNvbHZlO1xuZXhwb3J0cy5yZXNvbHZlT2JqZWN0ID0gdXJsUmVzb2x2ZU9iamVjdDtcbmV4cG9ydHMuZm9ybWF0ID0gdXJsRm9ybWF0O1xuXG5leHBvcnRzLlVybCA9IFVybDtcblxuZnVuY3Rpb24gVXJsKCkge1xuICB0aGlzLnByb3RvY29sID0gbnVsbDtcbiAgdGhpcy5zbGFzaGVzID0gbnVsbDtcbiAgdGhpcy5hdXRoID0gbnVsbDtcbiAgdGhpcy5ob3N0ID0gbnVsbDtcbiAgdGhpcy5wb3J0ID0gbnVsbDtcbiAgdGhpcy5ob3N0bmFtZSA9IG51bGw7XG4gIHRoaXMuaGFzaCA9IG51bGw7XG4gIHRoaXMuc2VhcmNoID0gbnVsbDtcbiAgdGhpcy5xdWVyeSA9IG51bGw7XG4gIHRoaXMucGF0aG5hbWUgPSBudWxsO1xuICB0aGlzLnBhdGggPSBudWxsO1xuICB0aGlzLmhyZWYgPSBudWxsO1xufVxuXG4vLyBSZWZlcmVuY2U6IFJGQyAzOTg2LCBSRkMgMTgwOCwgUkZDIDIzOTZcblxuLy8gZGVmaW5lIHRoZXNlIGhlcmUgc28gYXQgbGVhc3QgdGhleSBvbmx5IGhhdmUgdG8gYmVcbi8vIGNvbXBpbGVkIG9uY2Ugb24gdGhlIGZpcnN0IG1vZHVsZSBsb2FkLlxudmFyIHByb3RvY29sUGF0dGVybiA9IC9eKFthLXowLTkuKy1dKzopL2ksXG4gICAgcG9ydFBhdHRlcm4gPSAvOlswLTldKiQvLFxuXG4gICAgLy8gUkZDIDIzOTY6IGNoYXJhY3RlcnMgcmVzZXJ2ZWQgZm9yIGRlbGltaXRpbmcgVVJMcy5cbiAgICAvLyBXZSBhY3R1YWxseSBqdXN0IGF1dG8tZXNjYXBlIHRoZXNlLlxuICAgIGRlbGltcyA9IFsnPCcsICc+JywgJ1wiJywgJ2AnLCAnICcsICdcXHInLCAnXFxuJywgJ1xcdCddLFxuXG4gICAgLy8gUkZDIDIzOTY6IGNoYXJhY3RlcnMgbm90IGFsbG93ZWQgZm9yIHZhcmlvdXMgcmVhc29ucy5cbiAgICB1bndpc2UgPSBbJ3snLCAnfScsICd8JywgJ1xcXFwnLCAnXicsICdgJ10uY29uY2F0KGRlbGltcyksXG5cbiAgICAvLyBBbGxvd2VkIGJ5IFJGQ3MsIGJ1dCBjYXVzZSBvZiBYU1MgYXR0YWNrcy4gIEFsd2F5cyBlc2NhcGUgdGhlc2UuXG4gICAgYXV0b0VzY2FwZSA9IFsnXFwnJ10uY29uY2F0KHVud2lzZSksXG4gICAgLy8gQ2hhcmFjdGVycyB0aGF0IGFyZSBuZXZlciBldmVyIGFsbG93ZWQgaW4gYSBob3N0bmFtZS5cbiAgICAvLyBOb3RlIHRoYXQgYW55IGludmFsaWQgY2hhcnMgYXJlIGFsc28gaGFuZGxlZCwgYnV0IHRoZXNlXG4gICAgLy8gYXJlIHRoZSBvbmVzIHRoYXQgYXJlICpleHBlY3RlZCogdG8gYmUgc2Vlbiwgc28gd2UgZmFzdC1wYXRoXG4gICAgLy8gdGhlbS5cbiAgICBub25Ib3N0Q2hhcnMgPSBbJyUnLCAnLycsICc/JywgJzsnLCAnIyddLmNvbmNhdChhdXRvRXNjYXBlKSxcbiAgICBob3N0RW5kaW5nQ2hhcnMgPSBbJy8nLCAnPycsICcjJ10sXG4gICAgaG9zdG5hbWVNYXhMZW4gPSAyNTUsXG4gICAgaG9zdG5hbWVQYXJ0UGF0dGVybiA9IC9eW2EtejAtOUEtWl8tXXswLDYzfSQvLFxuICAgIGhvc3RuYW1lUGFydFN0YXJ0ID0gL14oW2EtejAtOUEtWl8tXXswLDYzfSkoLiopJC8sXG4gICAgLy8gcHJvdG9jb2xzIHRoYXQgY2FuIGFsbG93IFwidW5zYWZlXCIgYW5kIFwidW53aXNlXCIgY2hhcnMuXG4gICAgdW5zYWZlUHJvdG9jb2wgPSB7XG4gICAgICAnamF2YXNjcmlwdCc6IHRydWUsXG4gICAgICAnamF2YXNjcmlwdDonOiB0cnVlXG4gICAgfSxcbiAgICAvLyBwcm90b2NvbHMgdGhhdCBuZXZlciBoYXZlIGEgaG9zdG5hbWUuXG4gICAgaG9zdGxlc3NQcm90b2NvbCA9IHtcbiAgICAgICdqYXZhc2NyaXB0JzogdHJ1ZSxcbiAgICAgICdqYXZhc2NyaXB0Oic6IHRydWVcbiAgICB9LFxuICAgIC8vIHByb3RvY29scyB0aGF0IGFsd2F5cyBjb250YWluIGEgLy8gYml0LlxuICAgIHNsYXNoZWRQcm90b2NvbCA9IHtcbiAgICAgICdodHRwJzogdHJ1ZSxcbiAgICAgICdodHRwcyc6IHRydWUsXG4gICAgICAnZnRwJzogdHJ1ZSxcbiAgICAgICdnb3BoZXInOiB0cnVlLFxuICAgICAgJ2ZpbGUnOiB0cnVlLFxuICAgICAgJ2h0dHA6JzogdHJ1ZSxcbiAgICAgICdodHRwczonOiB0cnVlLFxuICAgICAgJ2Z0cDonOiB0cnVlLFxuICAgICAgJ2dvcGhlcjonOiB0cnVlLFxuICAgICAgJ2ZpbGU6JzogdHJ1ZVxuICAgIH0sXG4gICAgcXVlcnlzdHJpbmcgPSByZXF1aXJlKCdxdWVyeXN0cmluZycpO1xuXG5mdW5jdGlvbiB1cmxQYXJzZSh1cmwsIHBhcnNlUXVlcnlTdHJpbmcsIHNsYXNoZXNEZW5vdGVIb3N0KSB7XG4gIGlmICh1cmwgJiYgaXNPYmplY3QodXJsKSAmJiB1cmwgaW5zdGFuY2VvZiBVcmwpIHJldHVybiB1cmw7XG5cbiAgdmFyIHUgPSBuZXcgVXJsO1xuICB1LnBhcnNlKHVybCwgcGFyc2VRdWVyeVN0cmluZywgc2xhc2hlc0Rlbm90ZUhvc3QpO1xuICByZXR1cm4gdTtcbn1cblxuVXJsLnByb3RvdHlwZS5wYXJzZSA9IGZ1bmN0aW9uKHVybCwgcGFyc2VRdWVyeVN0cmluZywgc2xhc2hlc0Rlbm90ZUhvc3QpIHtcbiAgaWYgKCFpc1N0cmluZyh1cmwpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihcIlBhcmFtZXRlciAndXJsJyBtdXN0IGJlIGEgc3RyaW5nLCBub3QgXCIgKyB0eXBlb2YgdXJsKTtcbiAgfVxuXG4gIHZhciByZXN0ID0gdXJsO1xuXG4gIC8vIHRyaW0gYmVmb3JlIHByb2NlZWRpbmcuXG4gIC8vIFRoaXMgaXMgdG8gc3VwcG9ydCBwYXJzZSBzdHVmZiBsaWtlIFwiICBodHRwOi8vZm9vLmNvbSAgXFxuXCJcbiAgcmVzdCA9IHJlc3QudHJpbSgpO1xuXG4gIHZhciBwcm90byA9IHByb3RvY29sUGF0dGVybi5leGVjKHJlc3QpO1xuICBpZiAocHJvdG8pIHtcbiAgICBwcm90byA9IHByb3RvWzBdO1xuICAgIHZhciBsb3dlclByb3RvID0gcHJvdG8udG9Mb3dlckNhc2UoKTtcbiAgICB0aGlzLnByb3RvY29sID0gbG93ZXJQcm90bztcbiAgICByZXN0ID0gcmVzdC5zdWJzdHIocHJvdG8ubGVuZ3RoKTtcbiAgfVxuXG4gIC8vIGZpZ3VyZSBvdXQgaWYgaXQncyBnb3QgYSBob3N0XG4gIC8vIHVzZXJAc2VydmVyIGlzICphbHdheXMqIGludGVycHJldGVkIGFzIGEgaG9zdG5hbWUsIGFuZCB1cmxcbiAgLy8gcmVzb2x1dGlvbiB3aWxsIHRyZWF0IC8vZm9vL2JhciBhcyBob3N0PWZvbyxwYXRoPWJhciBiZWNhdXNlIHRoYXQnc1xuICAvLyBob3cgdGhlIGJyb3dzZXIgcmVzb2x2ZXMgcmVsYXRpdmUgVVJMcy5cbiAgaWYgKHNsYXNoZXNEZW5vdGVIb3N0IHx8IHByb3RvIHx8IHJlc3QubWF0Y2goL15cXC9cXC9bXkBcXC9dK0BbXkBcXC9dKy8pKSB7XG4gICAgdmFyIHNsYXNoZXMgPSByZXN0LnN1YnN0cigwLCAyKSA9PT0gJy8vJztcbiAgICBpZiAoc2xhc2hlcyAmJiAhKHByb3RvICYmIGhvc3RsZXNzUHJvdG9jb2xbcHJvdG9dKSkge1xuICAgICAgcmVzdCA9IHJlc3Quc3Vic3RyKDIpO1xuICAgICAgdGhpcy5zbGFzaGVzID0gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICBpZiAoIWhvc3RsZXNzUHJvdG9jb2xbcHJvdG9dICYmXG4gICAgICAoc2xhc2hlcyB8fCAocHJvdG8gJiYgIXNsYXNoZWRQcm90b2NvbFtwcm90b10pKSkge1xuXG4gICAgLy8gdGhlcmUncyBhIGhvc3RuYW1lLlxuICAgIC8vIHRoZSBmaXJzdCBpbnN0YW5jZSBvZiAvLCA/LCA7LCBvciAjIGVuZHMgdGhlIGhvc3QuXG4gICAgLy9cbiAgICAvLyBJZiB0aGVyZSBpcyBhbiBAIGluIHRoZSBob3N0bmFtZSwgdGhlbiBub24taG9zdCBjaGFycyAqYXJlKiBhbGxvd2VkXG4gICAgLy8gdG8gdGhlIGxlZnQgb2YgdGhlIGxhc3QgQCBzaWduLCB1bmxlc3Mgc29tZSBob3N0LWVuZGluZyBjaGFyYWN0ZXJcbiAgICAvLyBjb21lcyAqYmVmb3JlKiB0aGUgQC1zaWduLlxuICAgIC8vIFVSTHMgYXJlIG9ibm94aW91cy5cbiAgICAvL1xuICAgIC8vIGV4OlxuICAgIC8vIGh0dHA6Ly9hQGJAYy8gPT4gdXNlcjphQGIgaG9zdDpjXG4gICAgLy8gaHR0cDovL2FAYj9AYyA9PiB1c2VyOmEgaG9zdDpjIHBhdGg6Lz9AY1xuXG4gICAgLy8gdjAuMTIgVE9ETyhpc2FhY3MpOiBUaGlzIGlzIG5vdCBxdWl0ZSBob3cgQ2hyb21lIGRvZXMgdGhpbmdzLlxuICAgIC8vIFJldmlldyBvdXIgdGVzdCBjYXNlIGFnYWluc3QgYnJvd3NlcnMgbW9yZSBjb21wcmVoZW5zaXZlbHkuXG5cbiAgICAvLyBmaW5kIHRoZSBmaXJzdCBpbnN0YW5jZSBvZiBhbnkgaG9zdEVuZGluZ0NoYXJzXG4gICAgdmFyIGhvc3RFbmQgPSAtMTtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGhvc3RFbmRpbmdDaGFycy5sZW5ndGg7IGkrKykge1xuICAgICAgdmFyIGhlYyA9IHJlc3QuaW5kZXhPZihob3N0RW5kaW5nQ2hhcnNbaV0pO1xuICAgICAgaWYgKGhlYyAhPT0gLTEgJiYgKGhvc3RFbmQgPT09IC0xIHx8IGhlYyA8IGhvc3RFbmQpKVxuICAgICAgICBob3N0RW5kID0gaGVjO1xuICAgIH1cblxuICAgIC8vIGF0IHRoaXMgcG9pbnQsIGVpdGhlciB3ZSBoYXZlIGFuIGV4cGxpY2l0IHBvaW50IHdoZXJlIHRoZVxuICAgIC8vIGF1dGggcG9ydGlvbiBjYW5ub3QgZ28gcGFzdCwgb3IgdGhlIGxhc3QgQCBjaGFyIGlzIHRoZSBkZWNpZGVyLlxuICAgIHZhciBhdXRoLCBhdFNpZ247XG4gICAgaWYgKGhvc3RFbmQgPT09IC0xKSB7XG4gICAgICAvLyBhdFNpZ24gY2FuIGJlIGFueXdoZXJlLlxuICAgICAgYXRTaWduID0gcmVzdC5sYXN0SW5kZXhPZignQCcpO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBhdFNpZ24gbXVzdCBiZSBpbiBhdXRoIHBvcnRpb24uXG4gICAgICAvLyBodHRwOi8vYUBiL2NAZCA9PiBob3N0OmIgYXV0aDphIHBhdGg6L2NAZFxuICAgICAgYXRTaWduID0gcmVzdC5sYXN0SW5kZXhPZignQCcsIGhvc3RFbmQpO1xuICAgIH1cblxuICAgIC8vIE5vdyB3ZSBoYXZlIGEgcG9ydGlvbiB3aGljaCBpcyBkZWZpbml0ZWx5IHRoZSBhdXRoLlxuICAgIC8vIFB1bGwgdGhhdCBvZmYuXG4gICAgaWYgKGF0U2lnbiAhPT0gLTEpIHtcbiAgICAgIGF1dGggPSByZXN0LnNsaWNlKDAsIGF0U2lnbik7XG4gICAgICByZXN0ID0gcmVzdC5zbGljZShhdFNpZ24gKyAxKTtcbiAgICAgIHRoaXMuYXV0aCA9IGRlY29kZVVSSUNvbXBvbmVudChhdXRoKTtcbiAgICB9XG5cbiAgICAvLyB0aGUgaG9zdCBpcyB0aGUgcmVtYWluaW5nIHRvIHRoZSBsZWZ0IG9mIHRoZSBmaXJzdCBub24taG9zdCBjaGFyXG4gICAgaG9zdEVuZCA9IC0xO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbm9uSG9zdENoYXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICB2YXIgaGVjID0gcmVzdC5pbmRleE9mKG5vbkhvc3RDaGFyc1tpXSk7XG4gICAgICBpZiAoaGVjICE9PSAtMSAmJiAoaG9zdEVuZCA9PT0gLTEgfHwgaGVjIDwgaG9zdEVuZCkpXG4gICAgICAgIGhvc3RFbmQgPSBoZWM7XG4gICAgfVxuICAgIC8vIGlmIHdlIHN0aWxsIGhhdmUgbm90IGhpdCBpdCwgdGhlbiB0aGUgZW50aXJlIHRoaW5nIGlzIGEgaG9zdC5cbiAgICBpZiAoaG9zdEVuZCA9PT0gLTEpXG4gICAgICBob3N0RW5kID0gcmVzdC5sZW5ndGg7XG5cbiAgICB0aGlzLmhvc3QgPSByZXN0LnNsaWNlKDAsIGhvc3RFbmQpO1xuICAgIHJlc3QgPSByZXN0LnNsaWNlKGhvc3RFbmQpO1xuXG4gICAgLy8gcHVsbCBvdXQgcG9ydC5cbiAgICB0aGlzLnBhcnNlSG9zdCgpO1xuXG4gICAgLy8gd2UndmUgaW5kaWNhdGVkIHRoYXQgdGhlcmUgaXMgYSBob3N0bmFtZSxcbiAgICAvLyBzbyBldmVuIGlmIGl0J3MgZW1wdHksIGl0IGhhcyB0byBiZSBwcmVzZW50LlxuICAgIHRoaXMuaG9zdG5hbWUgPSB0aGlzLmhvc3RuYW1lIHx8ICcnO1xuXG4gICAgLy8gaWYgaG9zdG5hbWUgYmVnaW5zIHdpdGggWyBhbmQgZW5kcyB3aXRoIF1cbiAgICAvLyBhc3N1bWUgdGhhdCBpdCdzIGFuIElQdjYgYWRkcmVzcy5cbiAgICB2YXIgaXB2Nkhvc3RuYW1lID0gdGhpcy5ob3N0bmFtZVswXSA9PT0gJ1snICYmXG4gICAgICAgIHRoaXMuaG9zdG5hbWVbdGhpcy5ob3N0bmFtZS5sZW5ndGggLSAxXSA9PT0gJ10nO1xuXG4gICAgLy8gdmFsaWRhdGUgYSBsaXR0bGUuXG4gICAgaWYgKCFpcHY2SG9zdG5hbWUpIHtcbiAgICAgIHZhciBob3N0cGFydHMgPSB0aGlzLmhvc3RuYW1lLnNwbGl0KC9cXC4vKTtcbiAgICAgIGZvciAodmFyIGkgPSAwLCBsID0gaG9zdHBhcnRzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgICB2YXIgcGFydCA9IGhvc3RwYXJ0c1tpXTtcbiAgICAgICAgaWYgKCFwYXJ0KSBjb250aW51ZTtcbiAgICAgICAgaWYgKCFwYXJ0Lm1hdGNoKGhvc3RuYW1lUGFydFBhdHRlcm4pKSB7XG4gICAgICAgICAgdmFyIG5ld3BhcnQgPSAnJztcbiAgICAgICAgICBmb3IgKHZhciBqID0gMCwgayA9IHBhcnQubGVuZ3RoOyBqIDwgazsgaisrKSB7XG4gICAgICAgICAgICBpZiAocGFydC5jaGFyQ29kZUF0KGopID4gMTI3KSB7XG4gICAgICAgICAgICAgIC8vIHdlIHJlcGxhY2Ugbm9uLUFTQ0lJIGNoYXIgd2l0aCBhIHRlbXBvcmFyeSBwbGFjZWhvbGRlclxuICAgICAgICAgICAgICAvLyB3ZSBuZWVkIHRoaXMgdG8gbWFrZSBzdXJlIHNpemUgb2YgaG9zdG5hbWUgaXMgbm90XG4gICAgICAgICAgICAgIC8vIGJyb2tlbiBieSByZXBsYWNpbmcgbm9uLUFTQ0lJIGJ5IG5vdGhpbmdcbiAgICAgICAgICAgICAgbmV3cGFydCArPSAneCc7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBuZXdwYXJ0ICs9IHBhcnRbal07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIHdlIHRlc3QgYWdhaW4gd2l0aCBBU0NJSSBjaGFyIG9ubHlcbiAgICAgICAgICBpZiAoIW5ld3BhcnQubWF0Y2goaG9zdG5hbWVQYXJ0UGF0dGVybikpIHtcbiAgICAgICAgICAgIHZhciB2YWxpZFBhcnRzID0gaG9zdHBhcnRzLnNsaWNlKDAsIGkpO1xuICAgICAgICAgICAgdmFyIG5vdEhvc3QgPSBob3N0cGFydHMuc2xpY2UoaSArIDEpO1xuICAgICAgICAgICAgdmFyIGJpdCA9IHBhcnQubWF0Y2goaG9zdG5hbWVQYXJ0U3RhcnQpO1xuICAgICAgICAgICAgaWYgKGJpdCkge1xuICAgICAgICAgICAgICB2YWxpZFBhcnRzLnB1c2goYml0WzFdKTtcbiAgICAgICAgICAgICAgbm90SG9zdC51bnNoaWZ0KGJpdFsyXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAobm90SG9zdC5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgcmVzdCA9ICcvJyArIG5vdEhvc3Quam9pbignLicpICsgcmVzdDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMuaG9zdG5hbWUgPSB2YWxpZFBhcnRzLmpvaW4oJy4nKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0aGlzLmhvc3RuYW1lLmxlbmd0aCA+IGhvc3RuYW1lTWF4TGVuKSB7XG4gICAgICB0aGlzLmhvc3RuYW1lID0gJyc7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIGhvc3RuYW1lcyBhcmUgYWx3YXlzIGxvd2VyIGNhc2UuXG4gICAgICB0aGlzLmhvc3RuYW1lID0gdGhpcy5ob3N0bmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgIH1cblxuICAgIGlmICghaXB2Nkhvc3RuYW1lKSB7XG4gICAgICAvLyBJRE5BIFN1cHBvcnQ6IFJldHVybnMgYSBwdW55IGNvZGVkIHJlcHJlc2VudGF0aW9uIG9mIFwiZG9tYWluXCIuXG4gICAgICAvLyBJdCBvbmx5IGNvbnZlcnRzIHRoZSBwYXJ0IG9mIHRoZSBkb21haW4gbmFtZSB0aGF0XG4gICAgICAvLyBoYXMgbm9uIEFTQ0lJIGNoYXJhY3RlcnMuIEkuZS4gaXQgZG9zZW50IG1hdHRlciBpZlxuICAgICAgLy8geW91IGNhbGwgaXQgd2l0aCBhIGRvbWFpbiB0aGF0IGFscmVhZHkgaXMgaW4gQVNDSUkuXG4gICAgICB2YXIgZG9tYWluQXJyYXkgPSB0aGlzLmhvc3RuYW1lLnNwbGl0KCcuJyk7XG4gICAgICB2YXIgbmV3T3V0ID0gW107XG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IGRvbWFpbkFycmF5Lmxlbmd0aDsgKytpKSB7XG4gICAgICAgIHZhciBzID0gZG9tYWluQXJyYXlbaV07XG4gICAgICAgIG5ld091dC5wdXNoKHMubWF0Y2goL1teQS1aYS16MC05Xy1dLykgP1xuICAgICAgICAgICAgJ3huLS0nICsgcHVueWNvZGUuZW5jb2RlKHMpIDogcyk7XG4gICAgICB9XG4gICAgICB0aGlzLmhvc3RuYW1lID0gbmV3T3V0LmpvaW4oJy4nKTtcbiAgICB9XG5cbiAgICB2YXIgcCA9IHRoaXMucG9ydCA/ICc6JyArIHRoaXMucG9ydCA6ICcnO1xuICAgIHZhciBoID0gdGhpcy5ob3N0bmFtZSB8fCAnJztcbiAgICB0aGlzLmhvc3QgPSBoICsgcDtcbiAgICB0aGlzLmhyZWYgKz0gdGhpcy5ob3N0O1xuXG4gICAgLy8gc3RyaXAgWyBhbmQgXSBmcm9tIHRoZSBob3N0bmFtZVxuICAgIC8vIHRoZSBob3N0IGZpZWxkIHN0aWxsIHJldGFpbnMgdGhlbSwgdGhvdWdoXG4gICAgaWYgKGlwdjZIb3N0bmFtZSkge1xuICAgICAgdGhpcy5ob3N0bmFtZSA9IHRoaXMuaG9zdG5hbWUuc3Vic3RyKDEsIHRoaXMuaG9zdG5hbWUubGVuZ3RoIC0gMik7XG4gICAgICBpZiAocmVzdFswXSAhPT0gJy8nKSB7XG4gICAgICAgIHJlc3QgPSAnLycgKyByZXN0O1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIG5vdyByZXN0IGlzIHNldCB0byB0aGUgcG9zdC1ob3N0IHN0dWZmLlxuICAvLyBjaG9wIG9mZiBhbnkgZGVsaW0gY2hhcnMuXG4gIGlmICghdW5zYWZlUHJvdG9jb2xbbG93ZXJQcm90b10pIHtcblxuICAgIC8vIEZpcnN0LCBtYWtlIDEwMCUgc3VyZSB0aGF0IGFueSBcImF1dG9Fc2NhcGVcIiBjaGFycyBnZXRcbiAgICAvLyBlc2NhcGVkLCBldmVuIGlmIGVuY29kZVVSSUNvbXBvbmVudCBkb2Vzbid0IHRoaW5rIHRoZXlcbiAgICAvLyBuZWVkIHRvIGJlLlxuICAgIGZvciAodmFyIGkgPSAwLCBsID0gYXV0b0VzY2FwZS5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgIHZhciBhZSA9IGF1dG9Fc2NhcGVbaV07XG4gICAgICB2YXIgZXNjID0gZW5jb2RlVVJJQ29tcG9uZW50KGFlKTtcbiAgICAgIGlmIChlc2MgPT09IGFlKSB7XG4gICAgICAgIGVzYyA9IGVzY2FwZShhZSk7XG4gICAgICB9XG4gICAgICByZXN0ID0gcmVzdC5zcGxpdChhZSkuam9pbihlc2MpO1xuICAgIH1cbiAgfVxuXG5cbiAgLy8gY2hvcCBvZmYgZnJvbSB0aGUgdGFpbCBmaXJzdC5cbiAgdmFyIGhhc2ggPSByZXN0LmluZGV4T2YoJyMnKTtcbiAgaWYgKGhhc2ggIT09IC0xKSB7XG4gICAgLy8gZ290IGEgZnJhZ21lbnQgc3RyaW5nLlxuICAgIHRoaXMuaGFzaCA9IHJlc3Quc3Vic3RyKGhhc2gpO1xuICAgIHJlc3QgPSByZXN0LnNsaWNlKDAsIGhhc2gpO1xuICB9XG4gIHZhciBxbSA9IHJlc3QuaW5kZXhPZignPycpO1xuICBpZiAocW0gIT09IC0xKSB7XG4gICAgdGhpcy5zZWFyY2ggPSByZXN0LnN1YnN0cihxbSk7XG4gICAgdGhpcy5xdWVyeSA9IHJlc3Quc3Vic3RyKHFtICsgMSk7XG4gICAgaWYgKHBhcnNlUXVlcnlTdHJpbmcpIHtcbiAgICAgIHRoaXMucXVlcnkgPSBxdWVyeXN0cmluZy5wYXJzZSh0aGlzLnF1ZXJ5KTtcbiAgICB9XG4gICAgcmVzdCA9IHJlc3Quc2xpY2UoMCwgcW0pO1xuICB9IGVsc2UgaWYgKHBhcnNlUXVlcnlTdHJpbmcpIHtcbiAgICAvLyBubyBxdWVyeSBzdHJpbmcsIGJ1dCBwYXJzZVF1ZXJ5U3RyaW5nIHN0aWxsIHJlcXVlc3RlZFxuICAgIHRoaXMuc2VhcmNoID0gJyc7XG4gICAgdGhpcy5xdWVyeSA9IHt9O1xuICB9XG4gIGlmIChyZXN0KSB0aGlzLnBhdGhuYW1lID0gcmVzdDtcbiAgaWYgKHNsYXNoZWRQcm90b2NvbFtsb3dlclByb3RvXSAmJlxuICAgICAgdGhpcy5ob3N0bmFtZSAmJiAhdGhpcy5wYXRobmFtZSkge1xuICAgIHRoaXMucGF0aG5hbWUgPSAnLyc7XG4gIH1cblxuICAvL3RvIHN1cHBvcnQgaHR0cC5yZXF1ZXN0XG4gIGlmICh0aGlzLnBhdGhuYW1lIHx8IHRoaXMuc2VhcmNoKSB7XG4gICAgdmFyIHAgPSB0aGlzLnBhdGhuYW1lIHx8ICcnO1xuICAgIHZhciBzID0gdGhpcy5zZWFyY2ggfHwgJyc7XG4gICAgdGhpcy5wYXRoID0gcCArIHM7XG4gIH1cblxuICAvLyBmaW5hbGx5LCByZWNvbnN0cnVjdCB0aGUgaHJlZiBiYXNlZCBvbiB3aGF0IGhhcyBiZWVuIHZhbGlkYXRlZC5cbiAgdGhpcy5ocmVmID0gdGhpcy5mb3JtYXQoKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vLyBmb3JtYXQgYSBwYXJzZWQgb2JqZWN0IGludG8gYSB1cmwgc3RyaW5nXG5mdW5jdGlvbiB1cmxGb3JtYXQob2JqKSB7XG4gIC8vIGVuc3VyZSBpdCdzIGFuIG9iamVjdCwgYW5kIG5vdCBhIHN0cmluZyB1cmwuXG4gIC8vIElmIGl0J3MgYW4gb2JqLCB0aGlzIGlzIGEgbm8tb3AuXG4gIC8vIHRoaXMgd2F5LCB5b3UgY2FuIGNhbGwgdXJsX2Zvcm1hdCgpIG9uIHN0cmluZ3NcbiAgLy8gdG8gY2xlYW4gdXAgcG90ZW50aWFsbHkgd29ua3kgdXJscy5cbiAgaWYgKGlzU3RyaW5nKG9iaikpIG9iaiA9IHVybFBhcnNlKG9iaik7XG4gIGlmICghKG9iaiBpbnN0YW5jZW9mIFVybCkpIHJldHVybiBVcmwucHJvdG90eXBlLmZvcm1hdC5jYWxsKG9iaik7XG4gIHJldHVybiBvYmouZm9ybWF0KCk7XG59XG5cblVybC5wcm90b3R5cGUuZm9ybWF0ID0gZnVuY3Rpb24oKSB7XG4gIHZhciBhdXRoID0gdGhpcy5hdXRoIHx8ICcnO1xuICBpZiAoYXV0aCkge1xuICAgIGF1dGggPSBlbmNvZGVVUklDb21wb25lbnQoYXV0aCk7XG4gICAgYXV0aCA9IGF1dGgucmVwbGFjZSgvJTNBL2ksICc6Jyk7XG4gICAgYXV0aCArPSAnQCc7XG4gIH1cblxuICB2YXIgcHJvdG9jb2wgPSB0aGlzLnByb3RvY29sIHx8ICcnLFxuICAgICAgcGF0aG5hbWUgPSB0aGlzLnBhdGhuYW1lIHx8ICcnLFxuICAgICAgaGFzaCA9IHRoaXMuaGFzaCB8fCAnJyxcbiAgICAgIGhvc3QgPSBmYWxzZSxcbiAgICAgIHF1ZXJ5ID0gJyc7XG5cbiAgaWYgKHRoaXMuaG9zdCkge1xuICAgIGhvc3QgPSBhdXRoICsgdGhpcy5ob3N0O1xuICB9IGVsc2UgaWYgKHRoaXMuaG9zdG5hbWUpIHtcbiAgICBob3N0ID0gYXV0aCArICh0aGlzLmhvc3RuYW1lLmluZGV4T2YoJzonKSA9PT0gLTEgP1xuICAgICAgICB0aGlzLmhvc3RuYW1lIDpcbiAgICAgICAgJ1snICsgdGhpcy5ob3N0bmFtZSArICddJyk7XG4gICAgaWYgKHRoaXMucG9ydCkge1xuICAgICAgaG9zdCArPSAnOicgKyB0aGlzLnBvcnQ7XG4gICAgfVxuICB9XG5cbiAgaWYgKHRoaXMucXVlcnkgJiZcbiAgICAgIGlzT2JqZWN0KHRoaXMucXVlcnkpICYmXG4gICAgICBPYmplY3Qua2V5cyh0aGlzLnF1ZXJ5KS5sZW5ndGgpIHtcbiAgICBxdWVyeSA9IHF1ZXJ5c3RyaW5nLnN0cmluZ2lmeSh0aGlzLnF1ZXJ5KTtcbiAgfVxuXG4gIHZhciBzZWFyY2ggPSB0aGlzLnNlYXJjaCB8fCAocXVlcnkgJiYgKCc/JyArIHF1ZXJ5KSkgfHwgJyc7XG5cbiAgaWYgKHByb3RvY29sICYmIHByb3RvY29sLnN1YnN0cigtMSkgIT09ICc6JykgcHJvdG9jb2wgKz0gJzonO1xuXG4gIC8vIG9ubHkgdGhlIHNsYXNoZWRQcm90b2NvbHMgZ2V0IHRoZSAvLy4gIE5vdCBtYWlsdG86LCB4bXBwOiwgZXRjLlxuICAvLyB1bmxlc3MgdGhleSBoYWQgdGhlbSB0byBiZWdpbiB3aXRoLlxuICBpZiAodGhpcy5zbGFzaGVzIHx8XG4gICAgICAoIXByb3RvY29sIHx8IHNsYXNoZWRQcm90b2NvbFtwcm90b2NvbF0pICYmIGhvc3QgIT09IGZhbHNlKSB7XG4gICAgaG9zdCA9ICcvLycgKyAoaG9zdCB8fCAnJyk7XG4gICAgaWYgKHBhdGhuYW1lICYmIHBhdGhuYW1lLmNoYXJBdCgwKSAhPT0gJy8nKSBwYXRobmFtZSA9ICcvJyArIHBhdGhuYW1lO1xuICB9IGVsc2UgaWYgKCFob3N0KSB7XG4gICAgaG9zdCA9ICcnO1xuICB9XG5cbiAgaWYgKGhhc2ggJiYgaGFzaC5jaGFyQXQoMCkgIT09ICcjJykgaGFzaCA9ICcjJyArIGhhc2g7XG4gIGlmIChzZWFyY2ggJiYgc2VhcmNoLmNoYXJBdCgwKSAhPT0gJz8nKSBzZWFyY2ggPSAnPycgKyBzZWFyY2g7XG5cbiAgcGF0aG5hbWUgPSBwYXRobmFtZS5yZXBsYWNlKC9bPyNdL2csIGZ1bmN0aW9uKG1hdGNoKSB7XG4gICAgcmV0dXJuIGVuY29kZVVSSUNvbXBvbmVudChtYXRjaCk7XG4gIH0pO1xuICBzZWFyY2ggPSBzZWFyY2gucmVwbGFjZSgnIycsICclMjMnKTtcblxuICByZXR1cm4gcHJvdG9jb2wgKyBob3N0ICsgcGF0aG5hbWUgKyBzZWFyY2ggKyBoYXNoO1xufTtcblxuZnVuY3Rpb24gdXJsUmVzb2x2ZShzb3VyY2UsIHJlbGF0aXZlKSB7XG4gIHJldHVybiB1cmxQYXJzZShzb3VyY2UsIGZhbHNlLCB0cnVlKS5yZXNvbHZlKHJlbGF0aXZlKTtcbn1cblxuVXJsLnByb3RvdHlwZS5yZXNvbHZlID0gZnVuY3Rpb24ocmVsYXRpdmUpIHtcbiAgcmV0dXJuIHRoaXMucmVzb2x2ZU9iamVjdCh1cmxQYXJzZShyZWxhdGl2ZSwgZmFsc2UsIHRydWUpKS5mb3JtYXQoKTtcbn07XG5cbmZ1bmN0aW9uIHVybFJlc29sdmVPYmplY3Qoc291cmNlLCByZWxhdGl2ZSkge1xuICBpZiAoIXNvdXJjZSkgcmV0dXJuIHJlbGF0aXZlO1xuICByZXR1cm4gdXJsUGFyc2Uoc291cmNlLCBmYWxzZSwgdHJ1ZSkucmVzb2x2ZU9iamVjdChyZWxhdGl2ZSk7XG59XG5cblVybC5wcm90b3R5cGUucmVzb2x2ZU9iamVjdCA9IGZ1bmN0aW9uKHJlbGF0aXZlKSB7XG4gIGlmIChpc1N0cmluZyhyZWxhdGl2ZSkpIHtcbiAgICB2YXIgcmVsID0gbmV3IFVybCgpO1xuICAgIHJlbC5wYXJzZShyZWxhdGl2ZSwgZmFsc2UsIHRydWUpO1xuICAgIHJlbGF0aXZlID0gcmVsO1xuICB9XG5cbiAgdmFyIHJlc3VsdCA9IG5ldyBVcmwoKTtcbiAgT2JqZWN0LmtleXModGhpcykuZm9yRWFjaChmdW5jdGlvbihrKSB7XG4gICAgcmVzdWx0W2tdID0gdGhpc1trXTtcbiAgfSwgdGhpcyk7XG5cbiAgLy8gaGFzaCBpcyBhbHdheXMgb3ZlcnJpZGRlbiwgbm8gbWF0dGVyIHdoYXQuXG4gIC8vIGV2ZW4gaHJlZj1cIlwiIHdpbGwgcmVtb3ZlIGl0LlxuICByZXN1bHQuaGFzaCA9IHJlbGF0aXZlLmhhc2g7XG5cbiAgLy8gaWYgdGhlIHJlbGF0aXZlIHVybCBpcyBlbXB0eSwgdGhlbiB0aGVyZSdzIG5vdGhpbmcgbGVmdCB0byBkbyBoZXJlLlxuICBpZiAocmVsYXRpdmUuaHJlZiA9PT0gJycpIHtcbiAgICByZXN1bHQuaHJlZiA9IHJlc3VsdC5mb3JtYXQoKTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgLy8gaHJlZnMgbGlrZSAvL2Zvby9iYXIgYWx3YXlzIGN1dCB0byB0aGUgcHJvdG9jb2wuXG4gIGlmIChyZWxhdGl2ZS5zbGFzaGVzICYmICFyZWxhdGl2ZS5wcm90b2NvbCkge1xuICAgIC8vIHRha2UgZXZlcnl0aGluZyBleGNlcHQgdGhlIHByb3RvY29sIGZyb20gcmVsYXRpdmVcbiAgICBPYmplY3Qua2V5cyhyZWxhdGl2ZSkuZm9yRWFjaChmdW5jdGlvbihrKSB7XG4gICAgICBpZiAoayAhPT0gJ3Byb3RvY29sJylcbiAgICAgICAgcmVzdWx0W2tdID0gcmVsYXRpdmVba107XG4gICAgfSk7XG5cbiAgICAvL3VybFBhcnNlIGFwcGVuZHMgdHJhaWxpbmcgLyB0byB1cmxzIGxpa2UgaHR0cDovL3d3dy5leGFtcGxlLmNvbVxuICAgIGlmIChzbGFzaGVkUHJvdG9jb2xbcmVzdWx0LnByb3RvY29sXSAmJlxuICAgICAgICByZXN1bHQuaG9zdG5hbWUgJiYgIXJlc3VsdC5wYXRobmFtZSkge1xuICAgICAgcmVzdWx0LnBhdGggPSByZXN1bHQucGF0aG5hbWUgPSAnLyc7XG4gICAgfVxuXG4gICAgcmVzdWx0LmhyZWYgPSByZXN1bHQuZm9ybWF0KCk7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIGlmIChyZWxhdGl2ZS5wcm90b2NvbCAmJiByZWxhdGl2ZS5wcm90b2NvbCAhPT0gcmVzdWx0LnByb3RvY29sKSB7XG4gICAgLy8gaWYgaXQncyBhIGtub3duIHVybCBwcm90b2NvbCwgdGhlbiBjaGFuZ2luZ1xuICAgIC8vIHRoZSBwcm90b2NvbCBkb2VzIHdlaXJkIHRoaW5nc1xuICAgIC8vIGZpcnN0LCBpZiBpdCdzIG5vdCBmaWxlOiwgdGhlbiB3ZSBNVVNUIGhhdmUgYSBob3N0LFxuICAgIC8vIGFuZCBpZiB0aGVyZSB3YXMgYSBwYXRoXG4gICAgLy8gdG8gYmVnaW4gd2l0aCwgdGhlbiB3ZSBNVVNUIGhhdmUgYSBwYXRoLlxuICAgIC8vIGlmIGl0IGlzIGZpbGU6LCB0aGVuIHRoZSBob3N0IGlzIGRyb3BwZWQsXG4gICAgLy8gYmVjYXVzZSB0aGF0J3Mga25vd24gdG8gYmUgaG9zdGxlc3MuXG4gICAgLy8gYW55dGhpbmcgZWxzZSBpcyBhc3N1bWVkIHRvIGJlIGFic29sdXRlLlxuICAgIGlmICghc2xhc2hlZFByb3RvY29sW3JlbGF0aXZlLnByb3RvY29sXSkge1xuICAgICAgT2JqZWN0LmtleXMocmVsYXRpdmUpLmZvckVhY2goZnVuY3Rpb24oaykge1xuICAgICAgICByZXN1bHRba10gPSByZWxhdGl2ZVtrXTtcbiAgICAgIH0pO1xuICAgICAgcmVzdWx0LmhyZWYgPSByZXN1bHQuZm9ybWF0KCk7XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cblxuICAgIHJlc3VsdC5wcm90b2NvbCA9IHJlbGF0aXZlLnByb3RvY29sO1xuICAgIGlmICghcmVsYXRpdmUuaG9zdCAmJiAhaG9zdGxlc3NQcm90b2NvbFtyZWxhdGl2ZS5wcm90b2NvbF0pIHtcbiAgICAgIHZhciByZWxQYXRoID0gKHJlbGF0aXZlLnBhdGhuYW1lIHx8ICcnKS5zcGxpdCgnLycpO1xuICAgICAgd2hpbGUgKHJlbFBhdGgubGVuZ3RoICYmICEocmVsYXRpdmUuaG9zdCA9IHJlbFBhdGguc2hpZnQoKSkpO1xuICAgICAgaWYgKCFyZWxhdGl2ZS5ob3N0KSByZWxhdGl2ZS5ob3N0ID0gJyc7XG4gICAgICBpZiAoIXJlbGF0aXZlLmhvc3RuYW1lKSByZWxhdGl2ZS5ob3N0bmFtZSA9ICcnO1xuICAgICAgaWYgKHJlbFBhdGhbMF0gIT09ICcnKSByZWxQYXRoLnVuc2hpZnQoJycpO1xuICAgICAgaWYgKHJlbFBhdGgubGVuZ3RoIDwgMikgcmVsUGF0aC51bnNoaWZ0KCcnKTtcbiAgICAgIHJlc3VsdC5wYXRobmFtZSA9IHJlbFBhdGguam9pbignLycpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXN1bHQucGF0aG5hbWUgPSByZWxhdGl2ZS5wYXRobmFtZTtcbiAgICB9XG4gICAgcmVzdWx0LnNlYXJjaCA9IHJlbGF0aXZlLnNlYXJjaDtcbiAgICByZXN1bHQucXVlcnkgPSByZWxhdGl2ZS5xdWVyeTtcbiAgICByZXN1bHQuaG9zdCA9IHJlbGF0aXZlLmhvc3QgfHwgJyc7XG4gICAgcmVzdWx0LmF1dGggPSByZWxhdGl2ZS5hdXRoO1xuICAgIHJlc3VsdC5ob3N0bmFtZSA9IHJlbGF0aXZlLmhvc3RuYW1lIHx8IHJlbGF0aXZlLmhvc3Q7XG4gICAgcmVzdWx0LnBvcnQgPSByZWxhdGl2ZS5wb3J0O1xuICAgIC8vIHRvIHN1cHBvcnQgaHR0cC5yZXF1ZXN0XG4gICAgaWYgKHJlc3VsdC5wYXRobmFtZSB8fCByZXN1bHQuc2VhcmNoKSB7XG4gICAgICB2YXIgcCA9IHJlc3VsdC5wYXRobmFtZSB8fCAnJztcbiAgICAgIHZhciBzID0gcmVzdWx0LnNlYXJjaCB8fCAnJztcbiAgICAgIHJlc3VsdC5wYXRoID0gcCArIHM7XG4gICAgfVxuICAgIHJlc3VsdC5zbGFzaGVzID0gcmVzdWx0LnNsYXNoZXMgfHwgcmVsYXRpdmUuc2xhc2hlcztcbiAgICByZXN1bHQuaHJlZiA9IHJlc3VsdC5mb3JtYXQoKTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgdmFyIGlzU291cmNlQWJzID0gKHJlc3VsdC5wYXRobmFtZSAmJiByZXN1bHQucGF0aG5hbWUuY2hhckF0KDApID09PSAnLycpLFxuICAgICAgaXNSZWxBYnMgPSAoXG4gICAgICAgICAgcmVsYXRpdmUuaG9zdCB8fFxuICAgICAgICAgIHJlbGF0aXZlLnBhdGhuYW1lICYmIHJlbGF0aXZlLnBhdGhuYW1lLmNoYXJBdCgwKSA9PT0gJy8nXG4gICAgICApLFxuICAgICAgbXVzdEVuZEFicyA9IChpc1JlbEFicyB8fCBpc1NvdXJjZUFicyB8fFxuICAgICAgICAgICAgICAgICAgICAocmVzdWx0Lmhvc3QgJiYgcmVsYXRpdmUucGF0aG5hbWUpKSxcbiAgICAgIHJlbW92ZUFsbERvdHMgPSBtdXN0RW5kQWJzLFxuICAgICAgc3JjUGF0aCA9IHJlc3VsdC5wYXRobmFtZSAmJiByZXN1bHQucGF0aG5hbWUuc3BsaXQoJy8nKSB8fCBbXSxcbiAgICAgIHJlbFBhdGggPSByZWxhdGl2ZS5wYXRobmFtZSAmJiByZWxhdGl2ZS5wYXRobmFtZS5zcGxpdCgnLycpIHx8IFtdLFxuICAgICAgcHN5Y2hvdGljID0gcmVzdWx0LnByb3RvY29sICYmICFzbGFzaGVkUHJvdG9jb2xbcmVzdWx0LnByb3RvY29sXTtcblxuICAvLyBpZiB0aGUgdXJsIGlzIGEgbm9uLXNsYXNoZWQgdXJsLCB0aGVuIHJlbGF0aXZlXG4gIC8vIGxpbmtzIGxpa2UgLi4vLi4gc2hvdWxkIGJlIGFibGVcbiAgLy8gdG8gY3Jhd2wgdXAgdG8gdGhlIGhvc3RuYW1lLCBhcyB3ZWxsLiAgVGhpcyBpcyBzdHJhbmdlLlxuICAvLyByZXN1bHQucHJvdG9jb2wgaGFzIGFscmVhZHkgYmVlbiBzZXQgYnkgbm93LlxuICAvLyBMYXRlciBvbiwgcHV0IHRoZSBmaXJzdCBwYXRoIHBhcnQgaW50byB0aGUgaG9zdCBmaWVsZC5cbiAgaWYgKHBzeWNob3RpYykge1xuICAgIHJlc3VsdC5ob3N0bmFtZSA9ICcnO1xuICAgIHJlc3VsdC5wb3J0ID0gbnVsbDtcbiAgICBpZiAocmVzdWx0Lmhvc3QpIHtcbiAgICAgIGlmIChzcmNQYXRoWzBdID09PSAnJykgc3JjUGF0aFswXSA9IHJlc3VsdC5ob3N0O1xuICAgICAgZWxzZSBzcmNQYXRoLnVuc2hpZnQocmVzdWx0Lmhvc3QpO1xuICAgIH1cbiAgICByZXN1bHQuaG9zdCA9ICcnO1xuICAgIGlmIChyZWxhdGl2ZS5wcm90b2NvbCkge1xuICAgICAgcmVsYXRpdmUuaG9zdG5hbWUgPSBudWxsO1xuICAgICAgcmVsYXRpdmUucG9ydCA9IG51bGw7XG4gICAgICBpZiAocmVsYXRpdmUuaG9zdCkge1xuICAgICAgICBpZiAocmVsUGF0aFswXSA9PT0gJycpIHJlbFBhdGhbMF0gPSByZWxhdGl2ZS5ob3N0O1xuICAgICAgICBlbHNlIHJlbFBhdGgudW5zaGlmdChyZWxhdGl2ZS5ob3N0KTtcbiAgICAgIH1cbiAgICAgIHJlbGF0aXZlLmhvc3QgPSBudWxsO1xuICAgIH1cbiAgICBtdXN0RW5kQWJzID0gbXVzdEVuZEFicyAmJiAocmVsUGF0aFswXSA9PT0gJycgfHwgc3JjUGF0aFswXSA9PT0gJycpO1xuICB9XG5cbiAgaWYgKGlzUmVsQWJzKSB7XG4gICAgLy8gaXQncyBhYnNvbHV0ZS5cbiAgICByZXN1bHQuaG9zdCA9IChyZWxhdGl2ZS5ob3N0IHx8IHJlbGF0aXZlLmhvc3QgPT09ICcnKSA/XG4gICAgICAgICAgICAgICAgICByZWxhdGl2ZS5ob3N0IDogcmVzdWx0Lmhvc3Q7XG4gICAgcmVzdWx0Lmhvc3RuYW1lID0gKHJlbGF0aXZlLmhvc3RuYW1lIHx8IHJlbGF0aXZlLmhvc3RuYW1lID09PSAnJykgP1xuICAgICAgICAgICAgICAgICAgICAgIHJlbGF0aXZlLmhvc3RuYW1lIDogcmVzdWx0Lmhvc3RuYW1lO1xuICAgIHJlc3VsdC5zZWFyY2ggPSByZWxhdGl2ZS5zZWFyY2g7XG4gICAgcmVzdWx0LnF1ZXJ5ID0gcmVsYXRpdmUucXVlcnk7XG4gICAgc3JjUGF0aCA9IHJlbFBhdGg7XG4gICAgLy8gZmFsbCB0aHJvdWdoIHRvIHRoZSBkb3QtaGFuZGxpbmcgYmVsb3cuXG4gIH0gZWxzZSBpZiAocmVsUGF0aC5sZW5ndGgpIHtcbiAgICAvLyBpdCdzIHJlbGF0aXZlXG4gICAgLy8gdGhyb3cgYXdheSB0aGUgZXhpc3RpbmcgZmlsZSwgYW5kIHRha2UgdGhlIG5ldyBwYXRoIGluc3RlYWQuXG4gICAgaWYgKCFzcmNQYXRoKSBzcmNQYXRoID0gW107XG4gICAgc3JjUGF0aC5wb3AoKTtcbiAgICBzcmNQYXRoID0gc3JjUGF0aC5jb25jYXQocmVsUGF0aCk7XG4gICAgcmVzdWx0LnNlYXJjaCA9IHJlbGF0aXZlLnNlYXJjaDtcbiAgICByZXN1bHQucXVlcnkgPSByZWxhdGl2ZS5xdWVyeTtcbiAgfSBlbHNlIGlmICghaXNOdWxsT3JVbmRlZmluZWQocmVsYXRpdmUuc2VhcmNoKSkge1xuICAgIC8vIGp1c3QgcHVsbCBvdXQgdGhlIHNlYXJjaC5cbiAgICAvLyBsaWtlIGhyZWY9Jz9mb28nLlxuICAgIC8vIFB1dCB0aGlzIGFmdGVyIHRoZSBvdGhlciB0d28gY2FzZXMgYmVjYXVzZSBpdCBzaW1wbGlmaWVzIHRoZSBib29sZWFuc1xuICAgIGlmIChwc3ljaG90aWMpIHtcbiAgICAgIHJlc3VsdC5ob3N0bmFtZSA9IHJlc3VsdC5ob3N0ID0gc3JjUGF0aC5zaGlmdCgpO1xuICAgICAgLy9vY2NhdGlvbmFseSB0aGUgYXV0aCBjYW4gZ2V0IHN0dWNrIG9ubHkgaW4gaG9zdFxuICAgICAgLy90aGlzIGVzcGVjaWFseSBoYXBwZW5zIGluIGNhc2VzIGxpa2VcbiAgICAgIC8vdXJsLnJlc29sdmVPYmplY3QoJ21haWx0bzpsb2NhbDFAZG9tYWluMScsICdsb2NhbDJAZG9tYWluMicpXG4gICAgICB2YXIgYXV0aEluSG9zdCA9IHJlc3VsdC5ob3N0ICYmIHJlc3VsdC5ob3N0LmluZGV4T2YoJ0AnKSA+IDAgP1xuICAgICAgICAgICAgICAgICAgICAgICByZXN1bHQuaG9zdC5zcGxpdCgnQCcpIDogZmFsc2U7XG4gICAgICBpZiAoYXV0aEluSG9zdCkge1xuICAgICAgICByZXN1bHQuYXV0aCA9IGF1dGhJbkhvc3Quc2hpZnQoKTtcbiAgICAgICAgcmVzdWx0Lmhvc3QgPSByZXN1bHQuaG9zdG5hbWUgPSBhdXRoSW5Ib3N0LnNoaWZ0KCk7XG4gICAgICB9XG4gICAgfVxuICAgIHJlc3VsdC5zZWFyY2ggPSByZWxhdGl2ZS5zZWFyY2g7XG4gICAgcmVzdWx0LnF1ZXJ5ID0gcmVsYXRpdmUucXVlcnk7XG4gICAgLy90byBzdXBwb3J0IGh0dHAucmVxdWVzdFxuICAgIGlmICghaXNOdWxsKHJlc3VsdC5wYXRobmFtZSkgfHwgIWlzTnVsbChyZXN1bHQuc2VhcmNoKSkge1xuICAgICAgcmVzdWx0LnBhdGggPSAocmVzdWx0LnBhdGhuYW1lID8gcmVzdWx0LnBhdGhuYW1lIDogJycpICtcbiAgICAgICAgICAgICAgICAgICAgKHJlc3VsdC5zZWFyY2ggPyByZXN1bHQuc2VhcmNoIDogJycpO1xuICAgIH1cbiAgICByZXN1bHQuaHJlZiA9IHJlc3VsdC5mb3JtYXQoKTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgaWYgKCFzcmNQYXRoLmxlbmd0aCkge1xuICAgIC8vIG5vIHBhdGggYXQgYWxsLiAgZWFzeS5cbiAgICAvLyB3ZSd2ZSBhbHJlYWR5IGhhbmRsZWQgdGhlIG90aGVyIHN0dWZmIGFib3ZlLlxuICAgIHJlc3VsdC5wYXRobmFtZSA9IG51bGw7XG4gICAgLy90byBzdXBwb3J0IGh0dHAucmVxdWVzdFxuICAgIGlmIChyZXN1bHQuc2VhcmNoKSB7XG4gICAgICByZXN1bHQucGF0aCA9ICcvJyArIHJlc3VsdC5zZWFyY2g7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc3VsdC5wYXRoID0gbnVsbDtcbiAgICB9XG4gICAgcmVzdWx0LmhyZWYgPSByZXN1bHQuZm9ybWF0KCk7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfVxuXG4gIC8vIGlmIGEgdXJsIEVORHMgaW4gLiBvciAuLiwgdGhlbiBpdCBtdXN0IGdldCBhIHRyYWlsaW5nIHNsYXNoLlxuICAvLyBob3dldmVyLCBpZiBpdCBlbmRzIGluIGFueXRoaW5nIGVsc2Ugbm9uLXNsYXNoeSxcbiAgLy8gdGhlbiBpdCBtdXN0IE5PVCBnZXQgYSB0cmFpbGluZyBzbGFzaC5cbiAgdmFyIGxhc3QgPSBzcmNQYXRoLnNsaWNlKC0xKVswXTtcbiAgdmFyIGhhc1RyYWlsaW5nU2xhc2ggPSAoXG4gICAgICAocmVzdWx0Lmhvc3QgfHwgcmVsYXRpdmUuaG9zdCkgJiYgKGxhc3QgPT09ICcuJyB8fCBsYXN0ID09PSAnLi4nKSB8fFxuICAgICAgbGFzdCA9PT0gJycpO1xuXG4gIC8vIHN0cmlwIHNpbmdsZSBkb3RzLCByZXNvbHZlIGRvdWJsZSBkb3RzIHRvIHBhcmVudCBkaXJcbiAgLy8gaWYgdGhlIHBhdGggdHJpZXMgdG8gZ28gYWJvdmUgdGhlIHJvb3QsIGB1cGAgZW5kcyB1cCA+IDBcbiAgdmFyIHVwID0gMDtcbiAgZm9yICh2YXIgaSA9IHNyY1BhdGgubGVuZ3RoOyBpID49IDA7IGktLSkge1xuICAgIGxhc3QgPSBzcmNQYXRoW2ldO1xuICAgIGlmIChsYXN0ID09ICcuJykge1xuICAgICAgc3JjUGF0aC5zcGxpY2UoaSwgMSk7XG4gICAgfSBlbHNlIGlmIChsYXN0ID09PSAnLi4nKSB7XG4gICAgICBzcmNQYXRoLnNwbGljZShpLCAxKTtcbiAgICAgIHVwKys7XG4gICAgfSBlbHNlIGlmICh1cCkge1xuICAgICAgc3JjUGF0aC5zcGxpY2UoaSwgMSk7XG4gICAgICB1cC0tO1xuICAgIH1cbiAgfVxuXG4gIC8vIGlmIHRoZSBwYXRoIGlzIGFsbG93ZWQgdG8gZ28gYWJvdmUgdGhlIHJvb3QsIHJlc3RvcmUgbGVhZGluZyAuLnNcbiAgaWYgKCFtdXN0RW5kQWJzICYmICFyZW1vdmVBbGxEb3RzKSB7XG4gICAgZm9yICg7IHVwLS07IHVwKSB7XG4gICAgICBzcmNQYXRoLnVuc2hpZnQoJy4uJyk7XG4gICAgfVxuICB9XG5cbiAgaWYgKG11c3RFbmRBYnMgJiYgc3JjUGF0aFswXSAhPT0gJycgJiZcbiAgICAgICghc3JjUGF0aFswXSB8fCBzcmNQYXRoWzBdLmNoYXJBdCgwKSAhPT0gJy8nKSkge1xuICAgIHNyY1BhdGgudW5zaGlmdCgnJyk7XG4gIH1cblxuICBpZiAoaGFzVHJhaWxpbmdTbGFzaCAmJiAoc3JjUGF0aC5qb2luKCcvJykuc3Vic3RyKC0xKSAhPT0gJy8nKSkge1xuICAgIHNyY1BhdGgucHVzaCgnJyk7XG4gIH1cblxuICB2YXIgaXNBYnNvbHV0ZSA9IHNyY1BhdGhbMF0gPT09ICcnIHx8XG4gICAgICAoc3JjUGF0aFswXSAmJiBzcmNQYXRoWzBdLmNoYXJBdCgwKSA9PT0gJy8nKTtcblxuICAvLyBwdXQgdGhlIGhvc3QgYmFja1xuICBpZiAocHN5Y2hvdGljKSB7XG4gICAgcmVzdWx0Lmhvc3RuYW1lID0gcmVzdWx0Lmhvc3QgPSBpc0Fic29sdXRlID8gJycgOlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3JjUGF0aC5sZW5ndGggPyBzcmNQYXRoLnNoaWZ0KCkgOiAnJztcbiAgICAvL29jY2F0aW9uYWx5IHRoZSBhdXRoIGNhbiBnZXQgc3R1Y2sgb25seSBpbiBob3N0XG4gICAgLy90aGlzIGVzcGVjaWFseSBoYXBwZW5zIGluIGNhc2VzIGxpa2VcbiAgICAvL3VybC5yZXNvbHZlT2JqZWN0KCdtYWlsdG86bG9jYWwxQGRvbWFpbjEnLCAnbG9jYWwyQGRvbWFpbjInKVxuICAgIHZhciBhdXRoSW5Ib3N0ID0gcmVzdWx0Lmhvc3QgJiYgcmVzdWx0Lmhvc3QuaW5kZXhPZignQCcpID4gMCA/XG4gICAgICAgICAgICAgICAgICAgICByZXN1bHQuaG9zdC5zcGxpdCgnQCcpIDogZmFsc2U7XG4gICAgaWYgKGF1dGhJbkhvc3QpIHtcbiAgICAgIHJlc3VsdC5hdXRoID0gYXV0aEluSG9zdC5zaGlmdCgpO1xuICAgICAgcmVzdWx0Lmhvc3QgPSByZXN1bHQuaG9zdG5hbWUgPSBhdXRoSW5Ib3N0LnNoaWZ0KCk7XG4gICAgfVxuICB9XG5cbiAgbXVzdEVuZEFicyA9IG11c3RFbmRBYnMgfHwgKHJlc3VsdC5ob3N0ICYmIHNyY1BhdGgubGVuZ3RoKTtcblxuICBpZiAobXVzdEVuZEFicyAmJiAhaXNBYnNvbHV0ZSkge1xuICAgIHNyY1BhdGgudW5zaGlmdCgnJyk7XG4gIH1cblxuICBpZiAoIXNyY1BhdGgubGVuZ3RoKSB7XG4gICAgcmVzdWx0LnBhdGhuYW1lID0gbnVsbDtcbiAgICByZXN1bHQucGF0aCA9IG51bGw7XG4gIH0gZWxzZSB7XG4gICAgcmVzdWx0LnBhdGhuYW1lID0gc3JjUGF0aC5qb2luKCcvJyk7XG4gIH1cblxuICAvL3RvIHN1cHBvcnQgcmVxdWVzdC5odHRwXG4gIGlmICghaXNOdWxsKHJlc3VsdC5wYXRobmFtZSkgfHwgIWlzTnVsbChyZXN1bHQuc2VhcmNoKSkge1xuICAgIHJlc3VsdC5wYXRoID0gKHJlc3VsdC5wYXRobmFtZSA/IHJlc3VsdC5wYXRobmFtZSA6ICcnKSArXG4gICAgICAgICAgICAgICAgICAocmVzdWx0LnNlYXJjaCA/IHJlc3VsdC5zZWFyY2ggOiAnJyk7XG4gIH1cbiAgcmVzdWx0LmF1dGggPSByZWxhdGl2ZS5hdXRoIHx8IHJlc3VsdC5hdXRoO1xuICByZXN1bHQuc2xhc2hlcyA9IHJlc3VsdC5zbGFzaGVzIHx8IHJlbGF0aXZlLnNsYXNoZXM7XG4gIHJlc3VsdC5ocmVmID0gcmVzdWx0LmZvcm1hdCgpO1xuICByZXR1cm4gcmVzdWx0O1xufTtcblxuVXJsLnByb3RvdHlwZS5wYXJzZUhvc3QgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGhvc3QgPSB0aGlzLmhvc3Q7XG4gIHZhciBwb3J0ID0gcG9ydFBhdHRlcm4uZXhlYyhob3N0KTtcbiAgaWYgKHBvcnQpIHtcbiAgICBwb3J0ID0gcG9ydFswXTtcbiAgICBpZiAocG9ydCAhPT0gJzonKSB7XG4gICAgICB0aGlzLnBvcnQgPSBwb3J0LnN1YnN0cigxKTtcbiAgICB9XG4gICAgaG9zdCA9IGhvc3Quc3Vic3RyKDAsIGhvc3QubGVuZ3RoIC0gcG9ydC5sZW5ndGgpO1xuICB9XG4gIGlmIChob3N0KSB0aGlzLmhvc3RuYW1lID0gaG9zdDtcbn07XG5cbmZ1bmN0aW9uIGlzU3RyaW5nKGFyZykge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gXCJzdHJpbmdcIjtcbn1cblxuZnVuY3Rpb24gaXNPYmplY3QoYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnb2JqZWN0JyAmJiBhcmcgIT09IG51bGw7XG59XG5cbmZ1bmN0aW9uIGlzTnVsbChhcmcpIHtcbiAgcmV0dXJuIGFyZyA9PT0gbnVsbDtcbn1cbmZ1bmN0aW9uIGlzTnVsbE9yVW5kZWZpbmVkKGFyZykge1xuICByZXR1cm4gIGFyZyA9PSBudWxsO1xufVxuIiwiLypcbiAqIHF1YW50aXplLmpzIENvcHlyaWdodCAyMDA4IE5pY2sgUmFiaW5vd2l0elxuICogUG9ydGVkIHRvIG5vZGUuanMgYnkgT2xpdmllciBMZXNuaWNraVxuICogTGljZW5zZWQgdW5kZXIgdGhlIE1JVCBsaWNlbnNlOiBodHRwOi8vd3d3Lm9wZW5zb3VyY2Uub3JnL2xpY2Vuc2VzL21pdC1saWNlbnNlLnBocFxuICovXG5cbi8vIGZpbGwgb3V0IGEgY291cGxlIHByb3RvdmlzIGRlcGVuZGVuY2llc1xuLypcbiAqIEJsb2NrIGJlbG93IGNvcGllZCBmcm9tIFByb3RvdmlzOiBodHRwOi8vbWJvc3RvY2suZ2l0aHViLmNvbS9wcm90b3Zpcy9cbiAqIENvcHlyaWdodCAyMDEwIFN0YW5mb3JkIFZpc3VhbGl6YXRpb24gR3JvdXBcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBCU0QgTGljZW5zZTogaHR0cDovL3d3dy5vcGVuc291cmNlLm9yZy9saWNlbnNlcy9ic2QtbGljZW5zZS5waHBcbiAqL1xuaWYgKCFwdikge1xuICAgIHZhciBwdiA9IHtcbiAgICAgICAgbWFwOiBmdW5jdGlvbihhcnJheSwgZikge1xuICAgICAgICAgICAgdmFyIG8gPSB7fTtcbiAgICAgICAgICAgIHJldHVybiBmID8gYXJyYXkubWFwKGZ1bmN0aW9uKGQsIGkpIHtcbiAgICAgICAgICAgICAgICBvLmluZGV4ID0gaTtcbiAgICAgICAgICAgICAgICByZXR1cm4gZi5jYWxsKG8sIGQpO1xuICAgICAgICAgICAgfSkgOiBhcnJheS5zbGljZSgpO1xuICAgICAgICB9LFxuICAgICAgICBuYXR1cmFsT3JkZXI6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgIHJldHVybiAoYSA8IGIpID8gLTEgOiAoKGEgPiBiKSA/IDEgOiAwKTtcbiAgICAgICAgfSxcbiAgICAgICAgc3VtOiBmdW5jdGlvbihhcnJheSwgZikge1xuICAgICAgICAgICAgdmFyIG8gPSB7fTtcbiAgICAgICAgICAgIHJldHVybiBhcnJheS5yZWR1Y2UoZiA/IGZ1bmN0aW9uKHAsIGQsIGkpIHtcbiAgICAgICAgICAgICAgICBvLmluZGV4ID0gaTtcbiAgICAgICAgICAgICAgICByZXR1cm4gcCArIGYuY2FsbChvLCBkKTtcbiAgICAgICAgICAgIH0gOiBmdW5jdGlvbihwLCBkKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHAgKyBkO1xuICAgICAgICAgICAgfSwgMCk7XG4gICAgICAgIH0sXG4gICAgICAgIG1heDogZnVuY3Rpb24oYXJyYXksIGYpIHtcbiAgICAgICAgICAgIHJldHVybiBNYXRoLm1heC5hcHBseShudWxsLCBmID8gcHYubWFwKGFycmF5LCBmKSA6IGFycmF5KTtcbiAgICAgICAgfVxuICAgIH1cbn1cblxuLyoqXG4gKiBCYXNpYyBKYXZhc2NyaXB0IHBvcnQgb2YgdGhlIE1NQ1EgKG1vZGlmaWVkIG1lZGlhbiBjdXQgcXVhbnRpemF0aW9uKVxuICogYWxnb3JpdGhtIGZyb20gdGhlIExlcHRvbmljYSBsaWJyYXJ5IChodHRwOi8vd3d3LmxlcHRvbmljYS5jb20vKS5cbiAqIFJldHVybnMgYSBjb2xvciBtYXAgeW91IGNhbiB1c2UgdG8gbWFwIG9yaWdpbmFsIHBpeGVscyB0byB0aGUgcmVkdWNlZFxuICogcGFsZXR0ZS4gU3RpbGwgYSB3b3JrIGluIHByb2dyZXNzLlxuICogXG4gKiBAYXV0aG9yIE5pY2sgUmFiaW5vd2l0elxuICogQGV4YW1wbGVcbiBcbi8vIGFycmF5IG9mIHBpeGVscyBhcyBbUixHLEJdIGFycmF5c1xudmFyIG15UGl4ZWxzID0gW1sxOTAsMTk3LDE5MF0sIFsyMDIsMjA0LDIwMF0sIFsyMDcsMjE0LDIxMF0sIFsyMTEsMjE0LDIxMV0sIFsyMDUsMjA3LDIwN11cbiAgICAgICAgICAgICAgICAvLyBldGNcbiAgICAgICAgICAgICAgICBdO1xudmFyIG1heENvbG9ycyA9IDQ7XG4gXG52YXIgY21hcCA9IE1NQ1EucXVhbnRpemUobXlQaXhlbHMsIG1heENvbG9ycyk7XG52YXIgbmV3UGFsZXR0ZSA9IGNtYXAucGFsZXR0ZSgpO1xudmFyIG5ld1BpeGVscyA9IG15UGl4ZWxzLm1hcChmdW5jdGlvbihwKSB7IFxuICAgIHJldHVybiBjbWFwLm1hcChwKTsgXG59KTtcbiBcbiAqL1xudmFyIE1NQ1EgPSAoZnVuY3Rpb24oKSB7XG4gICAgLy8gcHJpdmF0ZSBjb25zdGFudHNcbiAgICB2YXIgc2lnYml0cyA9IDUsXG4gICAgICAgIHJzaGlmdCA9IDggLSBzaWdiaXRzLFxuICAgICAgICBtYXhJdGVyYXRpb25zID0gMTAwMCxcbiAgICAgICAgZnJhY3RCeVBvcHVsYXRpb25zID0gMC43NTtcblxuICAgIC8vIGdldCByZWR1Y2VkLXNwYWNlIGNvbG9yIGluZGV4IGZvciBhIHBpeGVsXG5cbiAgICBmdW5jdGlvbiBnZXRDb2xvckluZGV4KHIsIGcsIGIpIHtcbiAgICAgICAgcmV0dXJuIChyIDw8ICgyICogc2lnYml0cykpICsgKGcgPDwgc2lnYml0cykgKyBiO1xuICAgIH1cblxuICAgIC8vIFNpbXBsZSBwcmlvcml0eSBxdWV1ZVxuXG4gICAgZnVuY3Rpb24gUFF1ZXVlKGNvbXBhcmF0b3IpIHtcbiAgICAgICAgdmFyIGNvbnRlbnRzID0gW10sXG4gICAgICAgICAgICBzb3J0ZWQgPSBmYWxzZTtcblxuICAgICAgICBmdW5jdGlvbiBzb3J0KCkge1xuICAgICAgICAgICAgY29udGVudHMuc29ydChjb21wYXJhdG9yKTtcbiAgICAgICAgICAgIHNvcnRlZCA9IHRydWU7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgcHVzaDogZnVuY3Rpb24obykge1xuICAgICAgICAgICAgICAgIGNvbnRlbnRzLnB1c2gobyk7XG4gICAgICAgICAgICAgICAgc29ydGVkID0gZmFsc2U7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcGVlazogZnVuY3Rpb24oaW5kZXgpIHtcbiAgICAgICAgICAgICAgICBpZiAoIXNvcnRlZCkgc29ydCgpO1xuICAgICAgICAgICAgICAgIGlmIChpbmRleCA9PT0gdW5kZWZpbmVkKSBpbmRleCA9IGNvbnRlbnRzLmxlbmd0aCAtIDE7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNvbnRlbnRzW2luZGV4XTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBwb3A6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgIGlmICghc29ydGVkKSBzb3J0KCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNvbnRlbnRzLnBvcCgpO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHNpemU6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBjb250ZW50cy5sZW5ndGg7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgbWFwOiBmdW5jdGlvbihmKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNvbnRlbnRzLm1hcChmKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBkZWJ1ZzogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFzb3J0ZWQpIHNvcnQoKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gY29udGVudHM7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gM2QgY29sb3Igc3BhY2UgYm94XG5cbiAgICBmdW5jdGlvbiBWQm94KHIxLCByMiwgZzEsIGcyLCBiMSwgYjIsIGhpc3RvKSB7XG4gICAgICAgIHZhciB2Ym94ID0gdGhpcztcbiAgICAgICAgdmJveC5yMSA9IHIxO1xuICAgICAgICB2Ym94LnIyID0gcjI7XG4gICAgICAgIHZib3guZzEgPSBnMTtcbiAgICAgICAgdmJveC5nMiA9IGcyO1xuICAgICAgICB2Ym94LmIxID0gYjE7XG4gICAgICAgIHZib3guYjIgPSBiMjtcbiAgICAgICAgdmJveC5oaXN0byA9IGhpc3RvO1xuICAgIH1cbiAgICBWQm94LnByb3RvdHlwZSA9IHtcbiAgICAgICAgdm9sdW1lOiBmdW5jdGlvbihmb3JjZSkge1xuICAgICAgICAgICAgdmFyIHZib3ggPSB0aGlzO1xuICAgICAgICAgICAgaWYgKCF2Ym94Ll92b2x1bWUgfHwgZm9yY2UpIHtcbiAgICAgICAgICAgICAgICB2Ym94Ll92b2x1bWUgPSAoKHZib3gucjIgLSB2Ym94LnIxICsgMSkgKiAodmJveC5nMiAtIHZib3guZzEgKyAxKSAqICh2Ym94LmIyIC0gdmJveC5iMSArIDEpKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB2Ym94Ll92b2x1bWU7XG4gICAgICAgIH0sXG4gICAgICAgIGNvdW50OiBmdW5jdGlvbihmb3JjZSkge1xuICAgICAgICAgICAgdmFyIHZib3ggPSB0aGlzLFxuICAgICAgICAgICAgICAgIGhpc3RvID0gdmJveC5oaXN0bztcbiAgICAgICAgICAgIGlmICghdmJveC5fY291bnRfc2V0IHx8IGZvcmNlKSB7XG4gICAgICAgICAgICAgICAgdmFyIG5waXggPSAwLFxuICAgICAgICAgICAgICAgICAgICBpLCBqLCBrO1xuICAgICAgICAgICAgICAgIGZvciAoaSA9IHZib3gucjE7IGkgPD0gdmJveC5yMjsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgIGZvciAoaiA9IHZib3guZzE7IGogPD0gdmJveC5nMjsgaisrKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGsgPSB2Ym94LmIxOyBrIDw9IHZib3guYjI7IGsrKykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGluZGV4ID0gZ2V0Q29sb3JJbmRleChpLCBqLCBrKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBucGl4ICs9IChoaXN0b1tpbmRleF0gfHwgMCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdmJveC5fY291bnQgPSBucGl4O1xuICAgICAgICAgICAgICAgIHZib3guX2NvdW50X3NldCA9IHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdmJveC5fY291bnQ7XG4gICAgICAgIH0sXG4gICAgICAgIGNvcHk6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgdmFyIHZib3ggPSB0aGlzO1xuICAgICAgICAgICAgcmV0dXJuIG5ldyBWQm94KHZib3gucjEsIHZib3gucjIsIHZib3guZzEsIHZib3guZzIsIHZib3guYjEsIHZib3guYjIsIHZib3guaGlzdG8pO1xuICAgICAgICB9LFxuICAgICAgICBhdmc6IGZ1bmN0aW9uKGZvcmNlKSB7XG4gICAgICAgICAgICB2YXIgdmJveCA9IHRoaXMsXG4gICAgICAgICAgICAgICAgaGlzdG8gPSB2Ym94Lmhpc3RvO1xuICAgICAgICAgICAgaWYgKCF2Ym94Ll9hdmcgfHwgZm9yY2UpIHtcbiAgICAgICAgICAgICAgICB2YXIgbnRvdCA9IDAsXG4gICAgICAgICAgICAgICAgICAgIG11bHQgPSAxIDw8ICg4IC0gc2lnYml0cyksXG4gICAgICAgICAgICAgICAgICAgIHJzdW0gPSAwLFxuICAgICAgICAgICAgICAgICAgICBnc3VtID0gMCxcbiAgICAgICAgICAgICAgICAgICAgYnN1bSA9IDAsXG4gICAgICAgICAgICAgICAgICAgIGh2YWwsXG4gICAgICAgICAgICAgICAgICAgIGksIGosIGssIGhpc3RvaW5kZXg7XG4gICAgICAgICAgICAgICAgZm9yIChpID0gdmJveC5yMTsgaSA8PSB2Ym94LnIyOyBpKyspIHtcbiAgICAgICAgICAgICAgICAgICAgZm9yIChqID0gdmJveC5nMTsgaiA8PSB2Ym94LmcyOyBqKyspIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAoayA9IHZib3guYjE7IGsgPD0gdmJveC5iMjsgaysrKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaGlzdG9pbmRleCA9IGdldENvbG9ySW5kZXgoaSwgaiwgayk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgaHZhbCA9IGhpc3RvW2hpc3RvaW5kZXhdIHx8IDA7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbnRvdCArPSBodmFsO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJzdW0gKz0gKGh2YWwgKiAoaSArIDAuNSkgKiBtdWx0KTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBnc3VtICs9IChodmFsICogKGogKyAwLjUpICogbXVsdCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnN1bSArPSAoaHZhbCAqIChrICsgMC41KSAqIG11bHQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChudG90KSB7XG4gICAgICAgICAgICAgICAgICAgIHZib3guX2F2ZyA9IFt+fihyc3VtIC8gbnRvdCksIH5+IChnc3VtIC8gbnRvdCksIH5+IChic3VtIC8gbnRvdCldO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIC8vY29uc29sZS5sb2coJ2VtcHR5IGJveCcpO1xuICAgICAgICAgICAgICAgICAgICB2Ym94Ll9hdmcgPSBbfn4obXVsdCAqICh2Ym94LnIxICsgdmJveC5yMiArIDEpIC8gMiksIH5+IChtdWx0ICogKHZib3guZzEgKyB2Ym94LmcyICsgMSkgLyAyKSwgfn4gKG11bHQgKiAodmJveC5iMSArIHZib3guYjIgKyAxKSAvIDIpXTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdmJveC5fYXZnO1xuICAgICAgICB9LFxuICAgICAgICBjb250YWluczogZnVuY3Rpb24ocGl4ZWwpIHtcbiAgICAgICAgICAgIHZhciB2Ym94ID0gdGhpcyxcbiAgICAgICAgICAgICAgICBydmFsID0gcGl4ZWxbMF0gPj4gcnNoaWZ0O1xuICAgICAgICAgICAgZ3ZhbCA9IHBpeGVsWzFdID4+IHJzaGlmdDtcbiAgICAgICAgICAgIGJ2YWwgPSBwaXhlbFsyXSA+PiByc2hpZnQ7XG4gICAgICAgICAgICByZXR1cm4gKHJ2YWwgPj0gdmJveC5yMSAmJiBydmFsIDw9IHZib3gucjIgJiZcbiAgICAgICAgICAgICAgICBndmFsID49IHZib3guZzEgJiYgZ3ZhbCA8PSB2Ym94LmcyICYmXG4gICAgICAgICAgICAgICAgYnZhbCA+PSB2Ym94LmIxICYmIGJ2YWwgPD0gdmJveC5iMik7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgLy8gQ29sb3IgbWFwXG5cbiAgICBmdW5jdGlvbiBDTWFwKCkge1xuICAgICAgICB0aGlzLnZib3hlcyA9IG5ldyBQUXVldWUoZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgcmV0dXJuIHB2Lm5hdHVyYWxPcmRlcihcbiAgICAgICAgICAgICAgICBhLnZib3guY291bnQoKSAqIGEudmJveC52b2x1bWUoKSxcbiAgICAgICAgICAgICAgICBiLnZib3guY291bnQoKSAqIGIudmJveC52b2x1bWUoKVxuICAgICAgICAgICAgKVxuICAgICAgICB9KTs7XG4gICAgfVxuICAgIENNYXAucHJvdG90eXBlID0ge1xuICAgICAgICBwdXNoOiBmdW5jdGlvbih2Ym94KSB7XG4gICAgICAgICAgICB0aGlzLnZib3hlcy5wdXNoKHtcbiAgICAgICAgICAgICAgICB2Ym94OiB2Ym94LFxuICAgICAgICAgICAgICAgIGNvbG9yOiB2Ym94LmF2ZygpXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSxcbiAgICAgICAgcGFsZXR0ZTogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy52Ym94ZXMubWFwKGZ1bmN0aW9uKHZiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHZiLmNvbG9yXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSxcbiAgICAgICAgc2l6ZTogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy52Ym94ZXMuc2l6ZSgpO1xuICAgICAgICB9LFxuICAgICAgICBtYXA6IGZ1bmN0aW9uKGNvbG9yKSB7XG4gICAgICAgICAgICB2YXIgdmJveGVzID0gdGhpcy52Ym94ZXM7XG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHZib3hlcy5zaXplKCk7IGkrKykge1xuICAgICAgICAgICAgICAgIGlmICh2Ym94ZXMucGVlayhpKS52Ym94LmNvbnRhaW5zKGNvbG9yKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdmJveGVzLnBlZWsoaSkuY29sb3I7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMubmVhcmVzdChjb2xvcik7XG4gICAgICAgIH0sXG4gICAgICAgIG5lYXJlc3Q6IGZ1bmN0aW9uKGNvbG9yKSB7XG4gICAgICAgICAgICB2YXIgdmJveGVzID0gdGhpcy52Ym94ZXMsXG4gICAgICAgICAgICAgICAgZDEsIGQyLCBwQ29sb3I7XG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHZib3hlcy5zaXplKCk7IGkrKykge1xuICAgICAgICAgICAgICAgIGQyID0gTWF0aC5zcXJ0KFxuICAgICAgICAgICAgICAgICAgICBNYXRoLnBvdyhjb2xvclswXSAtIHZib3hlcy5wZWVrKGkpLmNvbG9yWzBdLCAyKSArXG4gICAgICAgICAgICAgICAgICAgIE1hdGgucG93KGNvbG9yWzFdIC0gdmJveGVzLnBlZWsoaSkuY29sb3JbMV0sIDIpICtcbiAgICAgICAgICAgICAgICAgICAgTWF0aC5wb3coY29sb3JbMl0gLSB2Ym94ZXMucGVlayhpKS5jb2xvclsyXSwgMilcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIGlmIChkMiA8IGQxIHx8IGQxID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgZDEgPSBkMjtcbiAgICAgICAgICAgICAgICAgICAgcENvbG9yID0gdmJveGVzLnBlZWsoaSkuY29sb3I7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHBDb2xvcjtcbiAgICAgICAgfSxcbiAgICAgICAgZm9yY2VidzogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICAvLyBYWFg6IHdvbid0ICB3b3JrIHlldFxuICAgICAgICAgICAgdmFyIHZib3hlcyA9IHRoaXMudmJveGVzO1xuICAgICAgICAgICAgdmJveGVzLnNvcnQoZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBwdi5uYXR1cmFsT3JkZXIocHYuc3VtKGEuY29sb3IpLCBwdi5zdW0oYi5jb2xvcikpXG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gZm9yY2UgZGFya2VzdCBjb2xvciB0byBibGFjayBpZiBldmVyeXRoaW5nIDwgNVxuICAgICAgICAgICAgdmFyIGxvd2VzdCA9IHZib3hlc1swXS5jb2xvcjtcbiAgICAgICAgICAgIGlmIChsb3dlc3RbMF0gPCA1ICYmIGxvd2VzdFsxXSA8IDUgJiYgbG93ZXN0WzJdIDwgNSlcbiAgICAgICAgICAgICAgICB2Ym94ZXNbMF0uY29sb3IgPSBbMCwgMCwgMF07XG5cbiAgICAgICAgICAgIC8vIGZvcmNlIGxpZ2h0ZXN0IGNvbG9yIHRvIHdoaXRlIGlmIGV2ZXJ5dGhpbmcgPiAyNTFcbiAgICAgICAgICAgIHZhciBpZHggPSB2Ym94ZXMubGVuZ3RoIC0gMSxcbiAgICAgICAgICAgICAgICBoaWdoZXN0ID0gdmJveGVzW2lkeF0uY29sb3I7XG4gICAgICAgICAgICBpZiAoaGlnaGVzdFswXSA+IDI1MSAmJiBoaWdoZXN0WzFdID4gMjUxICYmIGhpZ2hlc3RbMl0gPiAyNTEpXG4gICAgICAgICAgICAgICAgdmJveGVzW2lkeF0uY29sb3IgPSBbMjU1LCAyNTUsIDI1NV07XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgLy8gaGlzdG8gKDEtZCBhcnJheSwgZ2l2aW5nIHRoZSBudW1iZXIgb2YgcGl4ZWxzIGluXG4gICAgLy8gZWFjaCBxdWFudGl6ZWQgcmVnaW9uIG9mIGNvbG9yIHNwYWNlKSwgb3IgbnVsbCBvbiBlcnJvclxuXG4gICAgZnVuY3Rpb24gZ2V0SGlzdG8ocGl4ZWxzKSB7XG4gICAgICAgIHZhciBoaXN0b3NpemUgPSAxIDw8ICgzICogc2lnYml0cyksXG4gICAgICAgICAgICBoaXN0byA9IG5ldyBBcnJheShoaXN0b3NpemUpLFxuICAgICAgICAgICAgaW5kZXgsIHJ2YWwsIGd2YWwsIGJ2YWw7XG4gICAgICAgIHBpeGVscy5mb3JFYWNoKGZ1bmN0aW9uKHBpeGVsKSB7XG4gICAgICAgICAgICBydmFsID0gcGl4ZWxbMF0gPj4gcnNoaWZ0O1xuICAgICAgICAgICAgZ3ZhbCA9IHBpeGVsWzFdID4+IHJzaGlmdDtcbiAgICAgICAgICAgIGJ2YWwgPSBwaXhlbFsyXSA+PiByc2hpZnQ7XG4gICAgICAgICAgICBpbmRleCA9IGdldENvbG9ySW5kZXgocnZhbCwgZ3ZhbCwgYnZhbCk7XG4gICAgICAgICAgICBoaXN0b1tpbmRleF0gPSAoaGlzdG9baW5kZXhdIHx8IDApICsgMTtcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBoaXN0bztcbiAgICB9XG5cbiAgICBmdW5jdGlvbiB2Ym94RnJvbVBpeGVscyhwaXhlbHMsIGhpc3RvKSB7XG4gICAgICAgIHZhciBybWluID0gMTAwMDAwMCxcbiAgICAgICAgICAgIHJtYXggPSAwLFxuICAgICAgICAgICAgZ21pbiA9IDEwMDAwMDAsXG4gICAgICAgICAgICBnbWF4ID0gMCxcbiAgICAgICAgICAgIGJtaW4gPSAxMDAwMDAwLFxuICAgICAgICAgICAgYm1heCA9IDAsXG4gICAgICAgICAgICBydmFsLCBndmFsLCBidmFsO1xuICAgICAgICAvLyBmaW5kIG1pbi9tYXhcbiAgICAgICAgcGl4ZWxzLmZvckVhY2goZnVuY3Rpb24ocGl4ZWwpIHtcbiAgICAgICAgICAgIHJ2YWwgPSBwaXhlbFswXSA+PiByc2hpZnQ7XG4gICAgICAgICAgICBndmFsID0gcGl4ZWxbMV0gPj4gcnNoaWZ0O1xuICAgICAgICAgICAgYnZhbCA9IHBpeGVsWzJdID4+IHJzaGlmdDtcbiAgICAgICAgICAgIGlmIChydmFsIDwgcm1pbikgcm1pbiA9IHJ2YWw7XG4gICAgICAgICAgICBlbHNlIGlmIChydmFsID4gcm1heCkgcm1heCA9IHJ2YWw7XG4gICAgICAgICAgICBpZiAoZ3ZhbCA8IGdtaW4pIGdtaW4gPSBndmFsO1xuICAgICAgICAgICAgZWxzZSBpZiAoZ3ZhbCA+IGdtYXgpIGdtYXggPSBndmFsO1xuICAgICAgICAgICAgaWYgKGJ2YWwgPCBibWluKSBibWluID0gYnZhbDtcbiAgICAgICAgICAgIGVsc2UgaWYgKGJ2YWwgPiBibWF4KSBibWF4ID0gYnZhbDtcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBuZXcgVkJveChybWluLCBybWF4LCBnbWluLCBnbWF4LCBibWluLCBibWF4LCBoaXN0byk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gbWVkaWFuQ3V0QXBwbHkoaGlzdG8sIHZib3gpIHtcbiAgICAgICAgaWYgKCF2Ym94LmNvdW50KCkpIHJldHVybjtcblxuICAgICAgICB2YXIgcncgPSB2Ym94LnIyIC0gdmJveC5yMSArIDEsXG4gICAgICAgICAgICBndyA9IHZib3guZzIgLSB2Ym94LmcxICsgMSxcbiAgICAgICAgICAgIGJ3ID0gdmJveC5iMiAtIHZib3guYjEgKyAxLFxuICAgICAgICAgICAgbWF4dyA9IHB2Lm1heChbcncsIGd3LCBid10pO1xuICAgICAgICAvLyBvbmx5IG9uZSBwaXhlbCwgbm8gc3BsaXRcbiAgICAgICAgaWYgKHZib3guY291bnQoKSA9PSAxKSB7XG4gICAgICAgICAgICByZXR1cm4gW3Zib3guY29weSgpXVxuICAgICAgICB9XG4gICAgICAgIC8qIEZpbmQgdGhlIHBhcnRpYWwgc3VtIGFycmF5cyBhbG9uZyB0aGUgc2VsZWN0ZWQgYXhpcy4gKi9cbiAgICAgICAgdmFyIHRvdGFsID0gMCxcbiAgICAgICAgICAgIHBhcnRpYWxzdW0gPSBbXSxcbiAgICAgICAgICAgIGxvb2thaGVhZHN1bSA9IFtdLFxuICAgICAgICAgICAgaSwgaiwgaywgc3VtLCBpbmRleDtcbiAgICAgICAgaWYgKG1heHcgPT0gcncpIHtcbiAgICAgICAgICAgIGZvciAoaSA9IHZib3gucjE7IGkgPD0gdmJveC5yMjsgaSsrKSB7XG4gICAgICAgICAgICAgICAgc3VtID0gMDtcbiAgICAgICAgICAgICAgICBmb3IgKGogPSB2Ym94LmcxOyBqIDw9IHZib3guZzI7IGorKykge1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGsgPSB2Ym94LmIxOyBrIDw9IHZib3guYjI7IGsrKykge1xuICAgICAgICAgICAgICAgICAgICAgICAgaW5kZXggPSBnZXRDb2xvckluZGV4KGksIGosIGspO1xuICAgICAgICAgICAgICAgICAgICAgICAgc3VtICs9IChoaXN0b1tpbmRleF0gfHwgMCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdG90YWwgKz0gc3VtO1xuICAgICAgICAgICAgICAgIHBhcnRpYWxzdW1baV0gPSB0b3RhbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChtYXh3ID09IGd3KSB7XG4gICAgICAgICAgICBmb3IgKGkgPSB2Ym94LmcxOyBpIDw9IHZib3guZzI7IGkrKykge1xuICAgICAgICAgICAgICAgIHN1bSA9IDA7XG4gICAgICAgICAgICAgICAgZm9yIChqID0gdmJveC5yMTsgaiA8PSB2Ym94LnIyOyBqKyspIHtcbiAgICAgICAgICAgICAgICAgICAgZm9yIChrID0gdmJveC5iMTsgayA8PSB2Ym94LmIyOyBrKyspIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGluZGV4ID0gZ2V0Q29sb3JJbmRleChqLCBpLCBrKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN1bSArPSAoaGlzdG9baW5kZXhdIHx8IDApO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRvdGFsICs9IHN1bTtcbiAgICAgICAgICAgICAgICBwYXJ0aWFsc3VtW2ldID0gdG90YWw7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7IC8qIG1heHcgPT0gYncgKi9cbiAgICAgICAgICAgIGZvciAoaSA9IHZib3guYjE7IGkgPD0gdmJveC5iMjsgaSsrKSB7XG4gICAgICAgICAgICAgICAgc3VtID0gMDtcbiAgICAgICAgICAgICAgICBmb3IgKGogPSB2Ym94LnIxOyBqIDw9IHZib3gucjI7IGorKykge1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGsgPSB2Ym94LmcxOyBrIDw9IHZib3guZzI7IGsrKykge1xuICAgICAgICAgICAgICAgICAgICAgICAgaW5kZXggPSBnZXRDb2xvckluZGV4KGosIGssIGkpO1xuICAgICAgICAgICAgICAgICAgICAgICAgc3VtICs9IChoaXN0b1tpbmRleF0gfHwgMCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdG90YWwgKz0gc3VtO1xuICAgICAgICAgICAgICAgIHBhcnRpYWxzdW1baV0gPSB0b3RhbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBwYXJ0aWFsc3VtLmZvckVhY2goZnVuY3Rpb24oZCwgaSkge1xuICAgICAgICAgICAgbG9va2FoZWFkc3VtW2ldID0gdG90YWwgLSBkXG4gICAgICAgIH0pO1xuXG4gICAgICAgIGZ1bmN0aW9uIGRvQ3V0KGNvbG9yKSB7XG4gICAgICAgICAgICB2YXIgZGltMSA9IGNvbG9yICsgJzEnLFxuICAgICAgICAgICAgICAgIGRpbTIgPSBjb2xvciArICcyJyxcbiAgICAgICAgICAgICAgICBsZWZ0LCByaWdodCwgdmJveDEsIHZib3gyLCBkMiwgY291bnQyID0gMDtcbiAgICAgICAgICAgIGZvciAoaSA9IHZib3hbZGltMV07IGkgPD0gdmJveFtkaW0yXTsgaSsrKSB7XG4gICAgICAgICAgICAgICAgaWYgKHBhcnRpYWxzdW1baV0gPiB0b3RhbCAvIDIpIHtcbiAgICAgICAgICAgICAgICAgICAgdmJveDEgPSB2Ym94LmNvcHkoKTtcbiAgICAgICAgICAgICAgICAgICAgdmJveDIgPSB2Ym94LmNvcHkoKTtcbiAgICAgICAgICAgICAgICAgICAgbGVmdCA9IGkgLSB2Ym94W2RpbTFdO1xuICAgICAgICAgICAgICAgICAgICByaWdodCA9IHZib3hbZGltMl0gLSBpO1xuICAgICAgICAgICAgICAgICAgICBpZiAobGVmdCA8PSByaWdodClcbiAgICAgICAgICAgICAgICAgICAgICAgIGQyID0gTWF0aC5taW4odmJveFtkaW0yXSAtIDEsIH5+IChpICsgcmlnaHQgLyAyKSk7XG4gICAgICAgICAgICAgICAgICAgIGVsc2UgZDIgPSBNYXRoLm1heCh2Ym94W2RpbTFdLCB+fiAoaSAtIDEgLSBsZWZ0IC8gMikpO1xuICAgICAgICAgICAgICAgICAgICAvLyBhdm9pZCAwLWNvdW50IGJveGVzXG4gICAgICAgICAgICAgICAgICAgIHdoaWxlICghcGFydGlhbHN1bVtkMl0pIGQyKys7XG4gICAgICAgICAgICAgICAgICAgIGNvdW50MiA9IGxvb2thaGVhZHN1bVtkMl07XG4gICAgICAgICAgICAgICAgICAgIHdoaWxlICghY291bnQyICYmIHBhcnRpYWxzdW1bZDIgLSAxXSkgY291bnQyID0gbG9va2FoZWFkc3VtWy0tZDJdO1xuICAgICAgICAgICAgICAgICAgICAvLyBzZXQgZGltZW5zaW9uc1xuICAgICAgICAgICAgICAgICAgICB2Ym94MVtkaW0yXSA9IGQyO1xuICAgICAgICAgICAgICAgICAgICB2Ym94MltkaW0xXSA9IHZib3gxW2RpbTJdICsgMTtcbiAgICAgICAgICAgICAgICAgICAgLy8gY29uc29sZS5sb2coJ3Zib3ggY291bnRzOicsIHZib3guY291bnQoKSwgdmJveDEuY291bnQoKSwgdmJveDIuY291bnQoKSk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBbdmJveDEsIHZib3gyXTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgfVxuICAgICAgICAvLyBkZXRlcm1pbmUgdGhlIGN1dCBwbGFuZXNcbiAgICAgICAgcmV0dXJuIG1heHcgPT0gcncgPyBkb0N1dCgncicpIDpcbiAgICAgICAgICAgIG1heHcgPT0gZ3cgPyBkb0N1dCgnZycpIDpcbiAgICAgICAgICAgIGRvQ3V0KCdiJyk7XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gcXVhbnRpemUocGl4ZWxzLCBtYXhjb2xvcnMpIHtcbiAgICAgICAgLy8gc2hvcnQtY2lyY3VpdFxuICAgICAgICBpZiAoIXBpeGVscy5sZW5ndGggfHwgbWF4Y29sb3JzIDwgMiB8fCBtYXhjb2xvcnMgPiAyNTYpIHtcbiAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCd3cm9uZyBudW1iZXIgb2YgbWF4Y29sb3JzJyk7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBYWFg6IGNoZWNrIGNvbG9yIGNvbnRlbnQgYW5kIGNvbnZlcnQgdG8gZ3JheXNjYWxlIGlmIGluc3VmZmljaWVudFxuXG4gICAgICAgIHZhciBoaXN0byA9IGdldEhpc3RvKHBpeGVscyksXG4gICAgICAgICAgICBoaXN0b3NpemUgPSAxIDw8ICgzICogc2lnYml0cyk7XG5cbiAgICAgICAgLy8gY2hlY2sgdGhhdCB3ZSBhcmVuJ3QgYmVsb3cgbWF4Y29sb3JzIGFscmVhZHlcbiAgICAgICAgdmFyIG5Db2xvcnMgPSAwO1xuICAgICAgICBoaXN0by5mb3JFYWNoKGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgbkNvbG9ycysrXG4gICAgICAgIH0pO1xuICAgICAgICBpZiAobkNvbG9ycyA8PSBtYXhjb2xvcnMpIHtcbiAgICAgICAgICAgIC8vIFhYWDogZ2VuZXJhdGUgdGhlIG5ldyBjb2xvcnMgZnJvbSB0aGUgaGlzdG8gYW5kIHJldHVyblxuICAgICAgICB9XG5cbiAgICAgICAgLy8gZ2V0IHRoZSBiZWdpbm5pbmcgdmJveCBmcm9tIHRoZSBjb2xvcnNcbiAgICAgICAgdmFyIHZib3ggPSB2Ym94RnJvbVBpeGVscyhwaXhlbHMsIGhpc3RvKSxcbiAgICAgICAgICAgIHBxID0gbmV3IFBRdWV1ZShmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHB2Lm5hdHVyYWxPcmRlcihhLmNvdW50KCksIGIuY291bnQoKSlcbiAgICAgICAgICAgIH0pO1xuICAgICAgICBwcS5wdXNoKHZib3gpO1xuXG4gICAgICAgIC8vIGlubmVyIGZ1bmN0aW9uIHRvIGRvIHRoZSBpdGVyYXRpb25cblxuICAgICAgICBmdW5jdGlvbiBpdGVyKGxoLCB0YXJnZXQpIHtcbiAgICAgICAgICAgIHZhciBuY29sb3JzID0gMSxcbiAgICAgICAgICAgICAgICBuaXRlcnMgPSAwLFxuICAgICAgICAgICAgICAgIHZib3g7XG4gICAgICAgICAgICB3aGlsZSAobml0ZXJzIDwgbWF4SXRlcmF0aW9ucykge1xuICAgICAgICAgICAgICAgIHZib3ggPSBsaC5wb3AoKTtcbiAgICAgICAgICAgICAgICBpZiAoIXZib3guY291bnQoKSkgeyAvKiBqdXN0IHB1dCBpdCBiYWNrICovXG4gICAgICAgICAgICAgICAgICAgIGxoLnB1c2godmJveCk7XG4gICAgICAgICAgICAgICAgICAgIG5pdGVycysrO1xuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgLy8gZG8gdGhlIGN1dFxuICAgICAgICAgICAgICAgIHZhciB2Ym94ZXMgPSBtZWRpYW5DdXRBcHBseShoaXN0bywgdmJveCksXG4gICAgICAgICAgICAgICAgICAgIHZib3gxID0gdmJveGVzWzBdLFxuICAgICAgICAgICAgICAgICAgICB2Ym94MiA9IHZib3hlc1sxXTtcblxuICAgICAgICAgICAgICAgIGlmICghdmJveDEpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gY29uc29sZS5sb2coXCJ2Ym94MSBub3QgZGVmaW5lZDsgc2hvdWxkbid0IGhhcHBlbiFcIik7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbGgucHVzaCh2Ym94MSk7XG4gICAgICAgICAgICAgICAgaWYgKHZib3gyKSB7IC8qIHZib3gyIGNhbiBiZSBudWxsICovXG4gICAgICAgICAgICAgICAgICAgIGxoLnB1c2godmJveDIpO1xuICAgICAgICAgICAgICAgICAgICBuY29sb3JzKys7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChuY29sb3JzID49IHRhcmdldCkgcmV0dXJuO1xuICAgICAgICAgICAgICAgIGlmIChuaXRlcnMrKyA+IG1heEl0ZXJhdGlvbnMpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gY29uc29sZS5sb2coXCJpbmZpbml0ZSBsb29wOyBwZXJoYXBzIHRvbyBmZXcgcGl4ZWxzIVwiKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGZpcnN0IHNldCBvZiBjb2xvcnMsIHNvcnRlZCBieSBwb3B1bGF0aW9uXG4gICAgICAgIGl0ZXIocHEsIGZyYWN0QnlQb3B1bGF0aW9ucyAqIG1heGNvbG9ycyk7XG4gICAgICAgIC8vIGNvbnNvbGUubG9nKHBxLnNpemUoKSwgcHEuZGVidWcoKS5sZW5ndGgsIHBxLmRlYnVnKCkuc2xpY2UoKSk7XG5cbiAgICAgICAgLy8gUmUtc29ydCBieSB0aGUgcHJvZHVjdCBvZiBwaXhlbCBvY2N1cGFuY3kgdGltZXMgdGhlIHNpemUgaW4gY29sb3Igc3BhY2UuXG4gICAgICAgIHZhciBwcTIgPSBuZXcgUFF1ZXVlKGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgIHJldHVybiBwdi5uYXR1cmFsT3JkZXIoYS5jb3VudCgpICogYS52b2x1bWUoKSwgYi5jb3VudCgpICogYi52b2x1bWUoKSlcbiAgICAgICAgfSk7XG4gICAgICAgIHdoaWxlIChwcS5zaXplKCkpIHtcbiAgICAgICAgICAgIHBxMi5wdXNoKHBxLnBvcCgpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIG5leHQgc2V0IC0gZ2VuZXJhdGUgdGhlIG1lZGlhbiBjdXRzIHVzaW5nIHRoZSAobnBpeCAqIHZvbCkgc29ydGluZy5cbiAgICAgICAgaXRlcihwcTIsIG1heGNvbG9ycyAtIHBxMi5zaXplKCkpO1xuXG4gICAgICAgIC8vIGNhbGN1bGF0ZSB0aGUgYWN0dWFsIGNvbG9yc1xuICAgICAgICB2YXIgY21hcCA9IG5ldyBDTWFwKCk7XG4gICAgICAgIHdoaWxlIChwcTIuc2l6ZSgpKSB7XG4gICAgICAgICAgICBjbWFwLnB1c2gocHEyLnBvcCgpKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBjbWFwO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICAgIHF1YW50aXplOiBxdWFudGl6ZVxuICAgIH1cbn0pKCk7XG5cbm1vZHVsZS5leHBvcnRzID0gTU1DUS5xdWFudGl6ZVxuIiwiVmlicmFudCA9IHJlcXVpcmUoJy4vdmlicmFudCcpXG5WaWJyYW50LkRlZmF1bHRPcHRzLkltYWdlID0gcmVxdWlyZSgnLi9pbWFnZS9icm93c2VyJylcblxubW9kdWxlLmV4cG9ydHMgPSBWaWJyYW50XG4iLCJ3aW5kb3cuVmlicmFudCA9IFZpYnJhbnQgPSByZXF1aXJlKCcuL2Jyb3dzZXInKVxuIiwibW9kdWxlLmV4cG9ydHMgPSAociwgZywgYiwgYSkgLT5cclxuICBhID49IDEyNSBhbmQgbm90IChyID4gMjUwIGFuZCBnID4gMjUwIGFuZCBiID4gMjUwKVxyXG4iLCJtb2R1bGUuZXhwb3J0cy5EZWZhdWx0ID0gcmVxdWlyZSgnLi9kZWZhdWx0JylcclxuIiwiU3dhdGNoID0gcmVxdWlyZSgnLi4vc3dhdGNoJylcclxudXRpbCA9IHJlcXVpcmUoJy4uL3V0aWwnKVxyXG5HZW5lcmF0b3IgPSByZXF1aXJlKCcuL2luZGV4JylcclxuXHJcbkRlZmF1bHRPcHRzID1cclxuICB0YXJnZXREYXJrTHVtYTogMC4yNlxyXG4gIG1heERhcmtMdW1hOiAwLjQ1XHJcbiAgbWluTGlnaHRMdW1hOiAwLjU1XHJcbiAgdGFyZ2V0TGlnaHRMdW1hOiAwLjc0XHJcbiAgbWluTm9ybWFsTHVtYTogMC4zXHJcbiAgdGFyZ2V0Tm9ybWFsTHVtYTogMC41XHJcbiAgbWF4Tm9ybWFsTHVtYTogMC43XHJcbiAgdGFyZ2V0TXV0ZXNTYXR1cmF0aW9uOiAwLjNcclxuICBtYXhNdXRlc1NhdHVyYXRpb246IDAuNFxyXG4gIHRhcmdldFZpYnJhbnRTYXR1cmF0aW9uOiAxLjBcclxuICBtaW5WaWJyYW50U2F0dXJhdGlvbjogMC4zNVxyXG4gIHdlaWdodFNhdHVyYXRpb246IDNcclxuICB3ZWlnaHRMdW1hOiA2XHJcbiAgd2VpZ2h0UG9wdWxhdGlvbjogMVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPVxyXG5jbGFzcyBEZWZhdWx0R2VuZXJhdG9yIGV4dGVuZHMgR2VuZXJhdG9yXHJcbiAgSGlnaGVzdFBvcHVsYXRpb246IDBcclxuICBjb25zdHJ1Y3RvcjogKG9wdHMpIC0+XHJcbiAgICBAb3B0cyA9IHV0aWwuZGVmYXVsdHMob3B0cywgRGVmYXVsdE9wdHMpXHJcbiAgICBAVmlicmFudFN3YXRjaCA9IG51bGxcclxuICAgIEBMaWdodFZpYnJhbnRTd2F0Y2ggPSBudWxsXHJcbiAgICBARGFya1ZpYnJhbnRTd2F0Y2ggPSBudWxsXHJcbiAgICBATXV0ZWRTd2F0Y2ggPSBudWxsXHJcbiAgICBATGlnaHRNdXRlZFN3YXRjaCA9IG51bGxcclxuICAgIEBEYXJrTXV0ZWRTd2F0Y2ggPSBudWxsXHJcblxyXG4gIGdlbmVyYXRlOiAoQHN3YXRjaGVzKSAtPlxyXG4gICAgQG1heFBvcHVsYXRpb24gPSBAZmluZE1heFBvcHVsYXRpb25cclxuXHJcbiAgICBAZ2VuZXJhdGVWYXJhdGlvbkNvbG9ycygpXHJcbiAgICBAZ2VuZXJhdGVFbXB0eVN3YXRjaGVzKClcclxuXHJcbiAgZ2V0VmlicmFudFN3YXRjaDogLT5cclxuICAgIEBWaWJyYW50U3dhdGNoXHJcblxyXG4gIGdldExpZ2h0VmlicmFudFN3YXRjaDogLT5cclxuICAgIEBMaWdodFZpYnJhbnRTd2F0Y2hcclxuXHJcbiAgZ2V0RGFya1ZpYnJhbnRTd2F0Y2g6IC0+XHJcbiAgICBARGFya1ZpYnJhbnRTd2F0Y2hcclxuXHJcbiAgZ2V0TXV0ZWRTd2F0Y2g6IC0+XHJcbiAgICBATXV0ZWRTd2F0Y2hcclxuXHJcbiAgZ2V0TGlnaHRNdXRlZFN3YXRjaDogLT5cclxuICAgIEBMaWdodE11dGVkU3dhdGNoXHJcblxyXG4gIGdldERhcmtNdXRlZFN3YXRjaDogLT5cclxuICAgIEBEYXJrTXV0ZWRTd2F0Y2hcclxuXHJcbiAgZ2VuZXJhdGVWYXJhdGlvbkNvbG9yczogLT5cclxuICAgIEBWaWJyYW50U3dhdGNoID0gQGZpbmRDb2xvclZhcmlhdGlvbihAb3B0cy50YXJnZXROb3JtYWxMdW1hLCBAb3B0cy5taW5Ob3JtYWxMdW1hLCBAb3B0cy5tYXhOb3JtYWxMdW1hLFxyXG4gICAgICBAb3B0cy50YXJnZXRWaWJyYW50U2F0dXJhdGlvbiwgQG9wdHMubWluVmlicmFudFNhdHVyYXRpb24sIDEpO1xyXG5cclxuICAgIEBMaWdodFZpYnJhbnRTd2F0Y2ggPSBAZmluZENvbG9yVmFyaWF0aW9uKEBvcHRzLnRhcmdldExpZ2h0THVtYSwgQG9wdHMubWluTGlnaHRMdW1hLCAxLFxyXG4gICAgICBAb3B0cy50YXJnZXRWaWJyYW50U2F0dXJhdGlvbiwgQG9wdHMubWluVmlicmFudFNhdHVyYXRpb24sIDEpO1xyXG5cclxuICAgIEBEYXJrVmlicmFudFN3YXRjaCA9IEBmaW5kQ29sb3JWYXJpYXRpb24oQG9wdHMudGFyZ2V0RGFya0x1bWEsIDAsIEBvcHRzLm1heERhcmtMdW1hLFxyXG4gICAgICBAb3B0cy50YXJnZXRWaWJyYW50U2F0dXJhdGlvbiwgQG9wdHMubWluVmlicmFudFNhdHVyYXRpb24sIDEpO1xyXG5cclxuICAgIEBNdXRlZFN3YXRjaCA9IEBmaW5kQ29sb3JWYXJpYXRpb24oQG9wdHMudGFyZ2V0Tm9ybWFsTHVtYSwgQG9wdHMubWluTm9ybWFsTHVtYSwgQG9wdHMubWF4Tm9ybWFsTHVtYSxcclxuICAgICAgQG9wdHMudGFyZ2V0TXV0ZXNTYXR1cmF0aW9uLCAwLCBAb3B0cy5tYXhNdXRlc1NhdHVyYXRpb24pO1xyXG5cclxuICAgIEBMaWdodE11dGVkU3dhdGNoID0gQGZpbmRDb2xvclZhcmlhdGlvbihAb3B0cy50YXJnZXRMaWdodEx1bWEsIEBvcHRzLm1pbkxpZ2h0THVtYSwgMSxcclxuICAgICAgQG9wdHMudGFyZ2V0TXV0ZXNTYXR1cmF0aW9uLCAwLCBAb3B0cy5tYXhNdXRlc1NhdHVyYXRpb24pO1xyXG5cclxuICAgIEBEYXJrTXV0ZWRTd2F0Y2ggPSBAZmluZENvbG9yVmFyaWF0aW9uKEBvcHRzLnRhcmdldERhcmtMdW1hLCAwLCBAb3B0cy5tYXhEYXJrTHVtYSxcclxuICAgICAgQG9wdHMudGFyZ2V0TXV0ZXNTYXR1cmF0aW9uLCAwLCBAb3B0cy5tYXhNdXRlc1NhdHVyYXRpb24pO1xyXG5cclxuICBnZW5lcmF0ZUVtcHR5U3dhdGNoZXM6IC0+XHJcbiAgICBpZiBAVmlicmFudFN3YXRjaCBpcyBudWxsXHJcbiAgICAgICMgSWYgd2UgZG8gbm90IGhhdmUgYSB2aWJyYW50IGNvbG9yLi4uXHJcbiAgICAgIGlmIEBEYXJrVmlicmFudFN3YXRjaCBpc250IG51bGxcclxuICAgICAgICAjIC4uLmJ1dCB3ZSBkbyBoYXZlIGEgZGFyayB2aWJyYW50LCBnZW5lcmF0ZSB0aGUgdmFsdWUgYnkgbW9kaWZ5aW5nIHRoZSBsdW1hXHJcbiAgICAgICAgaHNsID0gQERhcmtWaWJyYW50U3dhdGNoLmdldEhzbCgpXHJcbiAgICAgICAgaHNsWzJdID0gQG9wdHMudGFyZ2V0Tm9ybWFsTHVtYVxyXG4gICAgICAgIEBWaWJyYW50U3dhdGNoID0gbmV3IFN3YXRjaCB1dGlsLmhzbFRvUmdiKGhzbFswXSwgaHNsWzFdLCBoc2xbMl0pLCAwXHJcblxyXG4gICAgaWYgQERhcmtWaWJyYW50U3dhdGNoIGlzIG51bGxcclxuICAgICAgIyBJZiB3ZSBkbyBub3QgaGF2ZSBhIHZpYnJhbnQgY29sb3IuLi5cclxuICAgICAgaWYgQFZpYnJhbnRTd2F0Y2ggaXNudCBudWxsXHJcbiAgICAgICAgIyAuLi5idXQgd2UgZG8gaGF2ZSBhIGRhcmsgdmlicmFudCwgZ2VuZXJhdGUgdGhlIHZhbHVlIGJ5IG1vZGlmeWluZyB0aGUgbHVtYVxyXG4gICAgICAgIGhzbCA9IEBWaWJyYW50U3dhdGNoLmdldEhzbCgpXHJcbiAgICAgICAgaHNsWzJdID0gQG9wdHMudGFyZ2V0RGFya0x1bWFcclxuICAgICAgICBARGFya1ZpYnJhbnRTd2F0Y2ggPSBuZXcgU3dhdGNoIHV0aWwuaHNsVG9SZ2IoaHNsWzBdLCBoc2xbMV0sIGhzbFsyXSksIDBcclxuXHJcbiAgZmluZE1heFBvcHVsYXRpb246IC0+XHJcbiAgICBwb3B1bGF0aW9uID0gMFxyXG4gICAgcG9wdWxhdGlvbiA9IE1hdGgubWF4KHBvcHVsYXRpb24sIHN3YXRjaC5nZXRQb3B1bGF0aW9uKCkpIGZvciBzd2F0Y2ggaW4gQHN3YXRjaGVzXHJcbiAgICBwb3B1bGF0aW9uXHJcblxyXG4gIGZpbmRDb2xvclZhcmlhdGlvbjogKHRhcmdldEx1bWEsIG1pbkx1bWEsIG1heEx1bWEsIHRhcmdldFNhdHVyYXRpb24sIG1pblNhdHVyYXRpb24sIG1heFNhdHVyYXRpb24pIC0+XHJcbiAgICBtYXggPSBudWxsXHJcbiAgICBtYXhWYWx1ZSA9IDBcclxuXHJcbiAgICBmb3Igc3dhdGNoIGluIEBzd2F0Y2hlc1xyXG4gICAgICBzYXQgPSBzd2F0Y2guZ2V0SHNsKClbMV07XHJcbiAgICAgIGx1bWEgPSBzd2F0Y2guZ2V0SHNsKClbMl1cclxuXHJcbiAgICAgIGlmIHNhdCA+PSBtaW5TYXR1cmF0aW9uIGFuZCBzYXQgPD0gbWF4U2F0dXJhdGlvbiBhbmRcclxuICAgICAgICBsdW1hID49IG1pbkx1bWEgYW5kIGx1bWEgPD0gbWF4THVtYSBhbmRcclxuICAgICAgICBub3QgQGlzQWxyZWFkeVNlbGVjdGVkKHN3YXRjaClcclxuICAgICAgICAgIHZhbHVlID0gQGNyZWF0ZUNvbXBhcmlzb25WYWx1ZSBzYXQsIHRhcmdldFNhdHVyYXRpb24sIGx1bWEsIHRhcmdldEx1bWEsXHJcbiAgICAgICAgICAgIHN3YXRjaC5nZXRQb3B1bGF0aW9uKCksIEBIaWdoZXN0UG9wdWxhdGlvblxyXG4gICAgICAgICAgaWYgbWF4IGlzIG51bGwgb3IgdmFsdWUgPiBtYXhWYWx1ZVxyXG4gICAgICAgICAgICBtYXggPSBzd2F0Y2hcclxuICAgICAgICAgICAgbWF4VmFsdWUgPSB2YWx1ZVxyXG5cclxuICAgIG1heFxyXG5cclxuICBjcmVhdGVDb21wYXJpc29uVmFsdWU6IChzYXR1cmF0aW9uLCB0YXJnZXRTYXR1cmF0aW9uLFxyXG4gICAgICBsdW1hLCB0YXJnZXRMdW1hLCBwb3B1bGF0aW9uLCBtYXhQb3B1bGF0aW9uKSAtPlxyXG4gICAgQHdlaWdodGVkTWVhbihcclxuICAgICAgQGludmVydERpZmYoc2F0dXJhdGlvbiwgdGFyZ2V0U2F0dXJhdGlvbiksIEBvcHRzLndlaWdodFNhdHVyYXRpb24sXHJcbiAgICAgIEBpbnZlcnREaWZmKGx1bWEsIHRhcmdldEx1bWEpLCBAb3B0cy53ZWlnaHRMdW1hLFxyXG4gICAgICBwb3B1bGF0aW9uIC8gbWF4UG9wdWxhdGlvbiwgQG9wdHMud2VpZ2h0UG9wdWxhdGlvblxyXG4gICAgKVxyXG5cclxuICBpbnZlcnREaWZmOiAodmFsdWUsIHRhcmdldFZhbHVlKSAtPlxyXG4gICAgMSAtIE1hdGguYWJzIHZhbHVlIC0gdGFyZ2V0VmFsdWVcclxuXHJcbiAgd2VpZ2h0ZWRNZWFuOiAodmFsdWVzLi4uKSAtPlxyXG4gICAgc3VtID0gMFxyXG4gICAgc3VtV2VpZ2h0ID0gMFxyXG4gICAgaSA9IDBcclxuICAgIHdoaWxlIGkgPCB2YWx1ZXMubGVuZ3RoXHJcbiAgICAgIHZhbHVlID0gdmFsdWVzW2ldXHJcbiAgICAgIHdlaWdodCA9IHZhbHVlc1tpICsgMV1cclxuICAgICAgc3VtICs9IHZhbHVlICogd2VpZ2h0XHJcbiAgICAgIHN1bVdlaWdodCArPSB3ZWlnaHRcclxuICAgICAgaSArPSAyXHJcbiAgICBzdW0gLyBzdW1XZWlnaHRcclxuXHJcbiAgaXNBbHJlYWR5U2VsZWN0ZWQ6IChzd2F0Y2gpIC0+XHJcbiAgICBAVmlicmFudFN3YXRjaCBpcyBzd2F0Y2ggb3IgQERhcmtWaWJyYW50U3dhdGNoIGlzIHN3YXRjaCBvclxyXG4gICAgICBATGlnaHRWaWJyYW50U3dhdGNoIGlzIHN3YXRjaCBvciBATXV0ZWRTd2F0Y2ggaXMgc3dhdGNoIG9yXHJcbiAgICAgIEBEYXJrTXV0ZWRTd2F0Y2ggaXMgc3dhdGNoIG9yIEBMaWdodE11dGVkU3dhdGNoIGlzIHN3YXRjaFxyXG4iLCJtb2R1bGUuZXhwb3J0cyA9XHJcbmNsYXNzIEdlbmVyYXRvclxyXG4gIGdlbmVyYXRlOiAoc3dhdGNoZXMpIC0+XHJcblxyXG4gIGdldFZpYnJhbnRTd2F0Y2g6IC0+XHJcblxyXG4gIGdldExpZ2h0VmlicmFudFN3YXRjaDogLT5cclxuXHJcbiAgZ2V0RGFya1ZpYnJhbnRTd2F0Y2g6IC0+XHJcblxyXG4gIGdldE11dGVkU3dhdGNoOiAtPlxyXG5cclxuICBnZXRMaWdodE11dGVkU3dhdGNoOiAtPlxyXG5cclxuICBnZXREYXJrTXV0ZWRTd2F0Y2g6IC0+XHJcblxyXG5tb2R1bGUuZXhwb3J0cy5EZWZhdWx0ID0gcmVxdWlyZSgnLi9kZWZhdWx0JylcclxuIiwiSW1hZ2UgPSByZXF1aXJlKCcuL2luZGV4JylcblVybCA9IHJlcXVpcmUoJ3VybCcpXG5cbmlzUmVsYXRpdmVVcmwgPSAodXJsKSAtPlxuICB1ID0gVXJsLnBhcnNlKHVybClcblxuICB1LnByb3RvY29sID09IG51bGwgJiYgdS5ob3N0ID09IG51bGwgJiYgdS5wb3J0ID09IG51bGxcblxuaXNTYW1lT3JpZ2luID0gKGEsIGIpIC0+XG4gIHVhID0gVXJsLnBhcnNlKGEpXG4gIHViID0gVXJsLnBhcnNlKGIpXG5cbiAgIyBodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9lbi1VUy9kb2NzL1dlYi9TZWN1cml0eS9TYW1lLW9yaWdpbl9wb2xpY3lcbiAgdWEucHJvdG9jb2wgPT0gdWIucHJvdG9jb2wgJiYgdWEuaG9zdG5hbWUgPT0gdWIuaG9zdG5hbWUgJiYgdWEucG9ydCA9PSB1Yi5wb3J0XG5cbm1vZHVsZS5leHBvcnRzID1cbmNsYXNzIEJyb3dzZXJJbWFnZSBleHRlbmRzIEltYWdlXG5cbiAgY29uc3RydWN0b3I6IChwYXRoLCBjYikgLT5cbiAgICBAaW1nID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnaW1nJylcbiAgICBpZiBub3QgaXNSZWxhdGl2ZVVybChwYXRoKSAmJiBub3QgaXNTYW1lT3JpZ2luKHdpbmRvdy5sb2NhdGlvbi5ocmVmLCBwYXRoKVxuICAgICAgQGltZy5jcm9zc09yaWdpbiA9ICdhbm9ueW1vdXMnXG4gICAgQGltZy5zcmMgPSBwYXRoXG5cbiAgICBAaW1nLm9ubG9hZCA9ID0+XG4gICAgICBAX2luaXRDYW52YXMoKVxuICAgICAgY2I/KG51bGwsIEApXG5cbiAgICBAaW1nLm9uZXJyb3IgPSAoZSkgPT5cbiAgICAgIGVyciA9IG5ldyBFcnJvcihcIkZhaWwgdG8gbG9hZCBpbWFnZTogXCIgKyBwYXRoKTtcbiAgICAgIGVyci5yYXcgPSBlO1xuICAgICAgY2I/KGVycilcblxuICBfaW5pdENhbnZhczogLT5cbiAgICBAY2FudmFzID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnY2FudmFzJylcbiAgICBAY29udGV4dCA9IEBjYW52YXMuZ2V0Q29udGV4dCgnMmQnKVxuICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQgQGNhbnZhc1xuICAgIEB3aWR0aCA9IEBjYW52YXMud2lkdGggPSBAaW1nLndpZHRoXG4gICAgQGhlaWdodCA9IEBjYW52YXMuaGVpZ2h0ID0gQGltZy5oZWlnaHRcbiAgICBAY29udGV4dC5kcmF3SW1hZ2UgQGltZywgMCwgMCwgQHdpZHRoLCBAaGVpZ2h0XG5cbiAgY2xlYXI6IC0+XG4gICAgQGNvbnRleHQuY2xlYXJSZWN0IDAsIDAsIEB3aWR0aCwgQGhlaWdodFxuXG4gIGdldFdpZHRoOiAtPlxuICAgIEB3aWR0aFxuXG4gIGdldEhlaWdodDogLT5cbiAgICBAaGVpZ2h0XG5cbiAgcmVzaXplOiAodywgaCwgcikgLT5cbiAgICBAd2lkdGggPSBAY2FudmFzLndpZHRoID0gd1xuICAgIEBoZWlnaHQgPSBAY2FudmFzLmhlaWdodCA9IGhcbiAgICBAY29udGV4dC5zY2FsZShyLCByKVxuICAgIEBjb250ZXh0LmRyYXdJbWFnZSBAaW1nLCAwLCAwXG5cbiAgdXBkYXRlOiAoaW1hZ2VEYXRhKSAtPlxuICAgIEBjb250ZXh0LnB1dEltYWdlRGF0YSBpbWFnZURhdGEsIDAsIDBcblxuICBnZXRQaXhlbENvdW50OiAtPlxuICAgIEB3aWR0aCAqIEBoZWlnaHRcblxuICBnZXRJbWFnZURhdGE6IC0+XG4gICAgQGNvbnRleHQuZ2V0SW1hZ2VEYXRhIDAsIDAsIEB3aWR0aCwgQGhlaWdodFxuXG4gIHJlbW92ZUNhbnZhczogLT5cbiAgICBAY2FudmFzLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQgQGNhbnZhc1xuIiwibW9kdWxlLmV4cG9ydHMgPVxuY2xhc3MgSW1hZ2VcbiAgY2xlYXI6IC0+XG5cbiAgdXBkYXRlOiAoaW1hZ2VEYXRhKSAtPlxuXG4gIGdldFdpZHRoOiAtPlxuXG4gIGdldEhlaWdodDogLT5cblxuICBzY2FsZURvd246IChvcHRzKSAtPlxuICAgIHdpZHRoID0gQGdldFdpZHRoKClcbiAgICBoZWlnaHQgPSBAZ2V0SGVpZ2h0KClcblxuICAgIHJhdGlvID0gMVxuICAgIGlmIG9wdHMubWF4RGltZW5zaW9uP1xuICAgICAgbWF4U2lkZSA9IE1hdGgubWF4KHdpZHRoLCBoZWlnaHQpXG4gICAgICBpZiBtYXhTaWRlID4gb3B0cy5tYXhEaW1lbnNpb25cbiAgICAgICAgcmF0aW8gPSBvcHRzLm1heERpbWVuc2lvbiAvIG1heFNpZGVcbiAgICBlbHNlXG4gICAgICByYXRpbyA9IDEgLyBvcHRzLnF1YWxpdHlcblxuICAgIGlmIHJhdGlvIDwgMVxuICAgICAgQHJlc2l6ZSB3aWR0aCAqIHJhdGlvLCBoZWlnaHQgKiByYXRpbywgcmF0aW9cblxuICByZXNpemU6ICh3LCBoLCByKSAtPlxuXG5cbiAgZ2V0UGl4ZWxDb3VudDogLT5cblxuICBnZXRJbWFnZURhdGE6IC0+XG5cbiAgcmVtb3ZlQ2FudmFzOiAtPlxuIiwiU3dhdGNoID0gcmVxdWlyZSgnLi4vc3dhdGNoJylcclxuUXVhbnRpemVyID0gcmVxdWlyZSgnLi9pbmRleCcpXHJcbnF1YW50aXplID0gcmVxdWlyZSgncXVhbnRpemUnKVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPVxyXG5jbGFzcyBCYXNlbGluZVF1YW50aXplciBleHRlbmRzIFF1YW50aXplclxyXG4gIGluaXRpYWxpemU6IChwaXhlbHMsIEBvcHRzKSAtPlxyXG4gICAgcGl4ZWxDb3VudCA9IHBpeGVscy5sZW5ndGggLyA0XHJcbiAgICBhbGxQaXhlbHMgPSBbXVxyXG4gICAgaSA9IDBcclxuXHJcbiAgICB3aGlsZSBpIDwgcGl4ZWxDb3VudFxyXG4gICAgICBvZmZzZXQgPSBpICogNFxyXG4gICAgICByID0gcGl4ZWxzW29mZnNldCArIDBdXHJcbiAgICAgIGcgPSBwaXhlbHNbb2Zmc2V0ICsgMV1cclxuICAgICAgYiA9IHBpeGVsc1tvZmZzZXQgKyAyXVxyXG4gICAgICBhID0gcGl4ZWxzW29mZnNldCArIDNdXHJcbiAgICAgICMgSWYgcGl4ZWwgaXMgbW9zdGx5IG9wYXF1ZSBhbmQgbm90IHdoaXRlXHJcbiAgICAgIGlmIGEgPj0gMTI1XHJcbiAgICAgICAgaWYgbm90IChyID4gMjUwIGFuZCBnID4gMjUwIGFuZCBiID4gMjUwKVxyXG4gICAgICAgICAgYWxsUGl4ZWxzLnB1c2ggW3IsIGcsIGJdXHJcbiAgICAgIGkgPSBpICsgQG9wdHMucXVhbGl0eVxyXG5cclxuXHJcbiAgICBjbWFwID0gcXVhbnRpemUgYWxsUGl4ZWxzLCBAb3B0cy5jb2xvckNvdW50XHJcbiAgICBAc3dhdGNoZXMgPSBjbWFwLnZib3hlcy5tYXAgKHZib3gpID0+XHJcbiAgICAgIG5ldyBTd2F0Y2ggdmJveC5jb2xvciwgdmJveC52Ym94LmNvdW50KClcclxuXHJcbiAgZ2V0UXVhbnRpemVkQ29sb3JzOiAtPlxyXG4gICAgQHN3YXRjaGVzXHJcbiIsIlN3YXRjaCA9IHJlcXVpcmUoJy4uL3N3YXRjaCcpXHJcblF1YW50aXplciA9IHJlcXVpcmUoJy4vaW5kZXgnKVxyXG5Db2xvckN1dCA9IHJlcXVpcmUoJy4vaW1wbC9jb2xvci1jdXQnKVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPVxyXG5jbGFzcyBDb2xvckN1dFF1YW50aXplciBleHRlbmRzIFF1YW50aXplclxyXG4gIGluaXRpYWxpemU6IChwaXhlbHMsIEBvcHRzKSAtPlxyXG4gICAgYnVmID0gbmV3IEFycmF5QnVmZmVyKHBpeGVscy5sZW5ndGgpXHJcbiAgICBidWY4ID0gbmV3IFVpbnQ4Q2xhbXBlZEFycmF5KGJ1ZilcclxuICAgIGRhdGEgPSBuZXcgVWludDMyQXJyYXkoYnVmKVxyXG4gICAgYnVmOC5zZXQocGl4ZWxzKVxyXG5cclxuICAgIEBxdWFudGl6ZXIgPSBuZXcgQ29sb3JDdXQoZGF0YSwgQG9wdHMpXHJcblxyXG5cclxuICBnZXRRdWFudGl6ZWRDb2xvcnM6IC0+XHJcbiAgICBAcXVhbnRpemVyLmdldFF1YW50aXplZENvbG9ycygpXHJcbiIsIiMgUHJpb3JpdHlRdWV1ZSA9IHJlcXVpcmUoJ2pzLXByaW9yaXR5LXF1ZXVlJylcclxuU3dhdGNoID0gcmVxdWlyZSgnLi4vLi4vc3dhdGNoJylcclxuXHJcbnNvcnQgPSAoYXJyLCBsb3dlciwgdXBwZXIpIC0+XHJcbiAgc3dhcCA9IChhLCBiKSAtPlxyXG4gICAgdCA9IGFyclthXVxyXG4gICAgYXJyW2FdID0gYXJyW2JdXHJcbiAgICBhcnJbYl0gPSB0XHJcblxyXG4gIHBhcnRpdGlvbiA9IChwaXZvdCwgbGVmdCwgcmlnaHQpIC0+XHJcbiAgICBpbmRleCA9IGxlZnRcclxuICAgIHZhbHVlID0gYXJyW3Bpdm90XVxyXG5cclxuICAgIHN3YXAocGl2b3QsIHJpZ2h0KVxyXG5cclxuICAgIGZvciB2IGluIFtsZWZ0Li5yaWdodCAtIDFdXHJcbiAgICAgIGlmIGFyclt2XSA+IHZhbHVlXHJcbiAgICAgICAgc3dhcCh2LCBpbmRleClcclxuICAgICAgICBpbmRleCsrXHJcblxyXG4gICAgc3dhcChyaWdodCwgaW5kZXgpXHJcblxyXG4gICAgaW5kZXhcclxuXHJcbiAgaWYgbG93ZXIgPCB1cHBlclxyXG4gICAgcGl2b3QgPSBsb3dlciArIE1hdGguY2VpbCgodXBwZXIgLSBsb3dlcikgLyAyKVxyXG4gICAgcGl2b3QgPSBwYXJ0aXRpb24ocGl2b3QsIGxvd2VyLCB1cHBlcilcclxuXHJcbiAgICBzb3J0KGFyciwgbG93ZXIsIHBpdm90IC0gMSlcclxuICAgIHNvcnQoYXJyLCBwaXZvdCArIDEsIHVwcGVyKVxyXG5cclxuXHJcbkNPTVBPTkVOVF9SRUQgICAgID0gLTNcclxuQ09NUE9ORU5UX0dSRUVOICAgPSAtMlxyXG5DT01QT05FTlRfQkxVRSAgICA9IC0xXHJcblxyXG5RVUFOVElaRV9XT1JEX1dJRFRIID0gNVxyXG5RVUFOVElaRV9XT1JEX01BU0sgID0gKDEgPDwgUVVBTlRJWkVfV09SRF9XSURUSCkgLSAxXHJcblxyXG4jIDMyYml0IGNvbG9yIG9yZGVyIG9uIGJpZy1lbmRpYW4gbWFjaGluZVxyXG5SR0JBQ29sb3IgPVxyXG4gIHJlZDogKGMpIC0+XHJcbiAgICBjPj4yNFxyXG4gIGdyZWVuOiAoYykgLT5cclxuICAgIGM8PDg+PjI0XHJcbiAgYmx1ZTogKGMpIC0+XHJcbiAgICBjPDwxNj4+MjRcclxuICBhbHBoYTogKGMpIC0+XHJcbiAgICBjPDwyND4+MjRcclxuXHJcbiMgMzJiaXQgY29sb3Igb3JkZXIgb24gbGl0dGxlLWVuZGlhbiBtYWNoaW5lXHJcbkFCR1JDb2xvciA9XHJcbiAgcmVkOiAoYykgLT5cclxuICAgIGM8PDI0Pj4yNFxyXG4gIGdyZWVuOiAoYykgLT5cclxuICAgIGM8PDE2Pj4yNFxyXG4gIGJsdWU6IChjKSAtPlxyXG4gICAgYzw8OD4+MjRcclxuICBhbHBoYTogKGMpIC0+XHJcbiAgICBjPj4yNFxyXG5cclxuaXNMaXR0bGVFbmRpYW4gPSAtPlxyXG4gIGEgPSBuZXcgQXJyYXlCdWZmZXIoNClcclxuICBiID0gbmV3IFVpbnQ4QXJyYXkoYSlcclxuICBjID0gbmV3IFVpbnQzMkFycmF5KGEpXHJcbiAgYlswXSA9IDB4YTFcclxuICBiWzFdID0gMHhiMlxyXG4gIGJbMl0gPSAweGMzXHJcbiAgYlszXSA9IDB4ZDRcclxuICBpZiBjWzBdID09IDB4ZDRjM2IyYTEgdGhlbiByZXR1cm4gdHJ1ZVxyXG4gIGlmIGNbMF0gPT0gMHhhMWIyYzNkNCB0aGVuIHJldHVybiBmYWxzZVxyXG4gIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBkZXRlcm1pbiBlbmRpYW5uZXNzXCIpXHJcblxyXG5Db2xvciA9IGlmIGlzTGl0dGxlRW5kaWFuKCkgdGhlbiBBQkdSQ29sb3IgZWxzZSBSR0JBQ29sb3JcclxuXHJcbm1vZGlmeVdvcmRXaWR0aCA9ICh2YWx1ZSwgY3VycmVudCwgdGFyZ2V0KSAtPlxyXG4gIG5ld1ZhbHVlID0gMFxyXG4gIGlmIHRhcmdldCA+IGN1cnJlbnRcclxuICAgIG5ld1ZhbHVlID0gdmFsdWUgPDwgKHRhcmdldCAtIGN1cnJlbnQpXHJcbiAgZWxzZVxyXG4gICAgbmV3VmFsdWUgPSB2YWx1ZSA+PiAoY3VycmVudCAtIHRhcmdldClcclxuXHJcbiAgbmV3VmFsdWUgJiAoKDE8PHRhcmdldCkgLSAxKVxyXG5cclxubW9kaWZ5U2lnbmlmaWNhbnRPY3RldCA9IChhLCBkaW1lbnNpb24sIGxvd2VyLCB1cHBlcikgLT5cclxuICBzd2l0Y2ggZGltZW5zaW9uXHJcbiAgICB3aGVuIENPTVBPTkVOVF9SRURcclxuICAgICAgYnJlYWtcclxuICAgIHdoZW4gQ09NUE9ORU5UX0dSRUVOXHJcbiAgICAgICMgUkdCIC0+IEdSQlxyXG4gICAgICBmb3IgaSBpbiBbbG93ZXIuLnVwcGVyXVxyXG4gICAgICAgIGNvbG9yID0gYVtpXVxyXG4gICAgICAgIGFbaV0gPSBxdWFudGl6ZWRHcmVlbihjb2xvcikgPDwgKFFVQU5USVpFX1dPUkRfV0lEVEggKyBRVUFOVElaRV9XT1JEX1dJRFRIKSBcXFxyXG4gICAgICAgICAgfCBxdWFudGl6ZWRSZWQoY29sb3IpIDw8IFFVQU5USVpFX1dPUkRfV0lEVEggXFxcclxuICAgICAgICAgIHwgcXVhbnRpemVkQmx1ZShjb2xvcilcclxuICAgICAgYnJlYWtcclxuICAgIHdoZW4gQ09NUE9ORU5UX0JMVUVcclxuICAgICAgIyBSR0IgLT4gQkdSXHJcbiAgICAgIGZvciBpIGluIFtsb3dlci4udXBwZXJdXHJcbiAgICAgICAgY29sb3IgPSBhW2ldXHJcbiAgICAgICAgYVtpXSA9IHF1YW50aXplZEJsdWUoY29sb3IpIDw8IChRVUFOVElaRV9XT1JEX1dJRFRIICsgUVVBTlRJWkVfV09SRF9XSURUSCkgXFxcclxuICAgICAgICAgIHwgcXVhbnRpemVkR3JlZW4oY29sb3IpIDw8IFFVQU5USVpFX1dPUkRfV0lEVEggXFxcclxuICAgICAgICAgIHwgcXVhbnRpemVkUmVkKGNvbG9yKVxyXG4gICAgICBicmVha1xyXG5cclxuIyBQbGF0Zm9ybSBkZXBlbmRlbnRcclxucXVhbnRpemVGcm9tUmdiODg4ID0gKGNvbG9yKSAtPlxyXG4gIHIgPSBtb2RpZnlXb3JkV2lkdGggQ29sb3IucmVkKGNvbG9yKSwgOCwgUVVBTlRJWkVfV09SRF9XSURUSFxyXG4gIGcgPSBtb2RpZnlXb3JkV2lkdGggQ29sb3IuZ3JlZW4oY29sb3IpLCA4LCBRVUFOVElaRV9XT1JEX1dJRFRIXHJcbiAgYiA9IG1vZGlmeVdvcmRXaWR0aCBDb2xvci5ibHVlKGNvbG9yKSwgOCwgUVVBTlRJWkVfV09SRF9XSURUSFxyXG5cclxuICByPDwoUVVBTlRJWkVfV09SRF9XSURUSCtRVUFOVElaRV9XT1JEX1dJRFRIKXxnPDxRVUFOVElaRV9XT1JEX1dJRFRIfGJcclxuXHJcbmFwcHJveGltYXRlVG9SZ2I4ODggPSAociwgZywgYikgLT5cclxuICBpZiBub3QgKGc/IGFuZCBiPylcclxuICAgIGNvbG9yID0gclxyXG4gICAgciA9IHF1YW50aXplZFJlZChjb2xvcilcclxuICAgIGcgPSBxdWFudGl6ZWRHcmVlbihjb2xvcilcclxuICAgIGIgPSBxdWFudGl6ZWRCbHVlKGNvbG9yKVxyXG4gIFtcclxuICAgIG1vZGlmeVdvcmRXaWR0aChyLCBRVUFOVElaRV9XT1JEX1dJRFRILCA4KVxyXG4gICAgbW9kaWZ5V29yZFdpZHRoKGcsIFFVQU5USVpFX1dPUkRfV0lEVEgsIDgpXHJcbiAgICBtb2RpZnlXb3JkV2lkdGgoYiwgUVVBTlRJWkVfV09SRF9XSURUSCwgOClcclxuICBdXHJcblxyXG5xdWFudGl6ZWRSZWQgPSAoY29sb3IpIC0+XHJcbiAgY29sb3IgPj4gKFFVQU5USVpFX1dPUkRfV0lEVEggKyBRVUFOVElaRV9XT1JEX1dJRFRIKSAmIFFVQU5USVpFX1dPUkRfTUFTS1xyXG5cclxucXVhbnRpemVkR3JlZW4gPSAoY29sb3IpIC0+XHJcbiAgY29sb3IgPj4gUVVBTlRJWkVfV09SRF9XSURUSCAmIFFVQU5USVpFX1dPUkRfTUFTS1xyXG5cclxucXVhbnRpemVkQmx1ZSA9IChjb2xvcikgLT5cclxuICBjb2xvciAmIFFVQU5USVpFX1dPUkRfTUFTS1xyXG5cclxuXHJcbm1vZHVsZS5leHBvcnRzID1cclxuY2xhc3MgQ29sb3JDdXRRdWFudGl6ZXJcclxuICBjb25zdHJ1Y3RvcjogKGRhdGEsIEBvcHRzKSAtPlxyXG4gICAgQGhpc3QgPSBuZXcgVWludDMyQXJyYXkoMSA8PCAoUVVBTlRJWkVfV09SRF9XSURUSCAqIDMpKVxyXG4gICAgQHBpeGVscyA9IG5ldyBVaW50MzJBcnJheShkYXRhLmxlbmd0aClcclxuICAgIGZvciBpIGluIFswLi5kYXRhLmxlbmd0aCAtIDFdXHJcbiAgICAgIEBwaXhlbHNbaV0gPSBxdWFudGl6ZWRDb2xvciA9IHF1YW50aXplRnJvbVJnYjg4OCBkYXRhW2ldXHJcbiAgICAgIEBoaXN0W3F1YW50aXplZENvbG9yXSsrXHJcblxyXG4gICAgZGlzdGluY3RDb2xvckNvdW50ID0gMFxyXG5cclxuICAgIGZvciBjb2xvciBpbiBbMC4uQGhpc3QubGVuZ3RoIC0gMV1cclxuICAgICAgIyBUT0RPOiBhcHBseSBmaWx0ZXJzXHJcbiAgICAgICMgaWYgQGhpc3RbY29sb3JdID4gMCBhbmQgQHNob3VsZElnbm9yZUNvbG9yKGNvbG9yKVxyXG4gICAgICAjICAgQGhpc3RbY29sb3JdID0gMFxyXG4gICAgICBpZiBAaGlzdFtjb2xvcl0gPiAwXHJcbiAgICAgICAgZGlzdGluY3RDb2xvckNvdW50KytcclxuXHJcbiAgICBAY29sb3JzID0gbmV3IFVpbnQzMkFycmF5KGRpc3RpbmN0Q29sb3JDb3VudClcclxuICAgIGRpc3RpbmN0Q29sb3JJbmRleCA9IDBcclxuXHJcbiAgICBmb3IgY29sb3IgaW4gWzAuLkBoaXN0Lmxlbmd0aCAtIDFdXHJcbiAgICAgIGlmIEBoaXN0W2NvbG9yXSA+IDBcclxuICAgICAgICBAY29sb3JzW2Rpc3RpbmN0Q29sb3JJbmRleCsrXSA9IGNvbG9yXHJcblxyXG4gICAgaWYgZGlzdGluY3RDb2xvckNvdW50IDw9IEBvcHRzLmNvbG9yQ291bnRcclxuICAgICAgQHF1YW50aXplZENvbG9ycyA9IFtdXHJcbiAgICAgIGZvciBpIGluIFswLi5AY29sb3JzLmxlbmd0aC0xXVxyXG4gICAgICAgIGMgPSBAY29sb3JzW2ldXHJcbiAgICAgICAgQHF1YW50aXplZENvbG9ycy5wdXNoIG5ldyBTd2F0Y2ggYXBwcm94aW1hdGVUb1JnYjg4OChjKSwgQGhpc3RbY11cclxuICAgIGVsc2VcclxuICAgICAgQHF1YW50aXplZENvbG9ycyA9IEBxdWFudGl6ZVBpeGVscyhAb3B0cy5jb2xvckNvdW50KVxyXG5cclxuICBnZXRRdWFudGl6ZWRDb2xvcnM6IC0+XHJcbiAgICBAcXVhbnRpemVkQ29sb3JzXHJcblxyXG4gIHF1YW50aXplUGl4ZWxzOiAobWF4Q29sb3JzKSAtPlxyXG4gICAgIyAvLyBDcmVhdGUgdGhlIHByaW9yaXR5IHF1ZXVlIHdoaWNoIGlzIHNvcnRlZCBieSB2b2x1bWUgZGVzY2VuZGluZy4gVGhpcyBtZWFucyB3ZSBhbHdheXNcclxuICAgICMgLy8gc3BsaXQgdGhlIGxhcmdlc3QgYm94IGluIHRoZSBxdWV1ZVxyXG4gICAgIyBmaW5hbCBQcmlvcml0eVF1ZXVlPFZib3g+IHBxID0gbmV3IFByaW9yaXR5UXVldWU8PihtYXhDb2xvcnMsIFZCT1hfQ09NUEFSQVRPUl9WT0xVTUUpO1xyXG4gICAgcHEgPSBuZXcgUHJpb3JpdHlRdWV1ZShjb21wYXJhdG9yOiBWYm94LmNvbXBhcmF0b3IpXHJcblxyXG4gICAgIyAvLyBUbyBzdGFydCwgb2ZmZXIgYSBib3ggd2hpY2ggY29udGFpbnMgYWxsIG9mIHRoZSBjb2xvcnNcclxuICAgICMgcHEub2ZmZXIobmV3IFZib3goMCwgbUNvbG9ycy5sZW5ndGggLSAxKSk7XHJcbiAgICBwcS5xdWV1ZShuZXcgVmJveChAY29sb3JzLCBAaGlzdCwgMCwgQGNvbG9ycy5sZW5ndGggLSAxKSlcclxuICAgICNcclxuICAgICMgLy8gTm93IGdvIHRocm91Z2ggdGhlIGJveGVzLCBzcGxpdHRpbmcgdGhlbSB1bnRpbCB3ZSBoYXZlIHJlYWNoZWQgbWF4Q29sb3JzIG9yIHRoZXJlIGFyZSBub1xyXG4gICAgIyAvLyBtb3JlIGJveGVzIHRvIHNwbGl0XHJcbiAgICAjIHNwbGl0Qm94ZXMocHEsIG1heENvbG9ycyk7XHJcbiAgICBAc3BsaXRCb3hlcyhwcSwgbWF4Q29sb3JzKVxyXG4gICAgI1xyXG4gICAgIyAvLyBGaW5hbGx5LCByZXR1cm4gdGhlIGF2ZXJhZ2UgY29sb3JzIG9mIHRoZSBjb2xvciBiXHJcbiAgICBAZ2VuZXJhdGVBdmVyYWdlQ29sb3JzKHBxKVxyXG5cclxuICBzcGxpdEJveGVzOiAocXVldWUsIG1heFNpemUpIC0+XHJcbiAgICB3aGlsZSBxdWV1ZS5sZW5ndGggPCBtYXhTaXplXHJcbiAgICAgIHZib3ggPSBxdWV1ZS5kZXF1ZXVlKClcclxuXHJcbiAgICAgIGlmIHZib3g/LmNhblNwbGl0KClcclxuICAgICAgICBxdWV1ZS5xdWV1ZSB2Ym94LnNwbGl0Qm94KClcclxuICAgICAgICBxdWV1ZS5xdWV1ZSB2Ym94XHJcbiAgICAgIGVsc2VcclxuICAgICAgICByZXR1cm5cclxuXHJcbiAgZ2VuZXJhdGVBdmVyYWdlQ29sb3JzOiAodmJveGVzKSAtPlxyXG4gICAgY29sb3JzID0gW11cclxuXHJcbiAgICB3aGlsZSB2Ym94ZXMubGVuZ3RoID4gMFxyXG4gICAgICBjb2xvcnMucHVzaCB2Ym94ZXMuZGVxdWV1ZSgpLmdldEF2ZXJhZ2VDb2xvcigpXHJcbiAgICAjIGNvbG9ycyA9IFtdXHJcbiAgICAjXHJcbiAgICAjIHZib3hlcy5mb3JFYWNoICh2Ym94KSA9PlxyXG4gICAgIyAgIHN3YXRjaCA9IHZib3guZ2V0QXZlcmFnZUNvbG9yKClcclxuICAgICMgICBpZiBub3QgQHNob3VsZElnbm9yZUNvbG9yXHJcbiAgICAjICAgICBjb2xvcnMucHVzaCBzd2F0Y2hcclxuXHJcbiAgICBjb2xvcnNcclxuXHJcbmNsYXNzIFZib3hcclxuICBAY29tcGFyYXRvcjogKGxocywgcmhzKSAtPlxyXG4gICAgbGhzLmdldFZvbHVtZSgpIC0gcmhzLmdldFZvbHVtZSgpXHJcblxyXG4gIGNvbnN0cnVjdG9yOiAoQGNvbG9ycywgQGhpc3QsIEBsb3dlckluZGV4LCBAdXBwZXJJbmRleCkgLT5cclxuICAgIEBmaXRCb3goKVxyXG5cclxuICBnZXRWb2x1bWU6IC0+XHJcbiAgICAoQG1heFJlZCAtIEBtaW5SZWQgKyAxKSAqIChAbWF4R3JlZW4gLSBAbWluR3JlZW4gKyAxKSAqIChAbWF4Qmx1ZSAtIEBtaW5CbHVlICsgMSlcclxuXHJcbiAgY2FuU3BsaXQ6IC0+XHJcbiAgICBAZ2V0Q29sb3JDb3VudCgpID4gMVxyXG5cclxuICBnZXRDb2xvckNvdW50OiAtPlxyXG4gICAgMSArIEB1cHBlckluZGV4IC0gQGxvd2VySW5kZXhcclxuXHJcbiAgZml0Qm94OiAtPlxyXG4gICAgQG1pblJlZCA9IEBtaW5HcmVlbiA9IEBtaW5CbHVlID0gTnVtYmVyLk1BWF9WQUxVRVxyXG4gICAgQG1heFJlZCA9IEBtYXhHcmVlbiA9IEBtYXhCbHVlID0gTnVtYmVyLk1JTl9WQUxVRVxyXG4gICAgQHBvcHVsYXRpb24gPSAwXHJcbiAgICBjb3VudCA9IDBcclxuICAgIGZvciBpIGluIFtAbG93ZXJJbmRleC4uQHVwcGVySW5kZXhdXHJcbiAgICAgIGNvbG9yID0gQGNvbG9yc1tpXVxyXG4gICAgICBjb3VudCArPSBAaGlzdFtjb2xvcl1cclxuXHJcbiAgICAgIHIgPSBxdWFudGl6ZWRSZWQgY29sb3JcclxuICAgICAgZyA9IHF1YW50aXplZEdyZWVuIGNvbG9yXHJcbiAgICAgIGIgPSBxdWFudGl6ZWRCbHVlIGNvbG9yXHJcblxyXG4gICAgICBpZiByID4gQG1heFJlZCB0aGVuIEBtYXhSZWQgPSByXHJcbiAgICAgIGlmIHIgPCBAbWluUmVkIHRoZW4gQG1pblJlZCA9IHJcclxuICAgICAgaWYgZyA+IEBtYXhHcmVlbiB0aGVuIEBtYXhHcmVlbiA9IGdcclxuICAgICAgaWYgZyA8IEBtaW5HcmVlbiB0aGVuIEBtaW5HcmVlbiA9IGdcclxuICAgICAgaWYgYiA+IEBtYXhCbHVlIHRoZW4gQG1heFJlZCA9IGJcclxuICAgICAgaWYgYiA8IEBtaW5CbHVlIHRoZW4gQG1pblJlZCA9IGJcclxuXHJcbiAgICBAcG9wdWxhdGlvbiA9IGNvdW50XHJcblxyXG4gIHNwbGl0Qm94OiAtPlxyXG4gICAgaWYgbm90IEBjYW5TcGxpdCgpXHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBzcGxpdCBhIGJveCB3aXRoIG9ubHkgMSBjb2xvclwiKVxyXG5cclxuICAgIHNwbGl0UG9pbnQgPSBAZmluZFNwbGl0UG9pbnQoKVxyXG5cclxuICAgIG5ld0JveCA9IG5ldyBWYm94KEBjb2xvcnMsIEBoaXN0LCBzcGxpdFBvaW50ICsgMSwgQHVwcGVySW5kZXgpXHJcblxyXG4gICAgIyBOb3cgY2hhbmdlIHRoaXMgYm94J3MgdXBwZXJJbmRleCBhbmQgcmVjb21wdXRlIHRoZSBjb2xvciBib3VuZGFyaWVzXHJcbiAgICBAdXBwZXJJbmRleCA9IHNwbGl0UG9pbnRcclxuICAgIEBmaXRCb3goKVxyXG5cclxuICAgIG5ld0JveFxyXG5cclxuICBnZXRMb25nZXN0Q29sb3JEaW1lbnNpb246IC0+XHJcbiAgICByZWRMZW5ndGggPSBAbWF4UmVkIC0gQG1pblJlZFxyXG4gICAgZ3JlZW5MZW5ndGggPSBAbWF4R3JlZW4gLSBAbWluR3JlZW5cclxuICAgIGJsdWVMZW5ndGggPSBAbWF4Qmx1ZSAtIEBtaW5CbHVlXHJcblxyXG4gICAgaWYgcmVkTGVuZ3RoID49IGdyZWVuTGVuZ3RoIGFuZCByZWRMZW5ndGggPj0gYmx1ZUxlbmd0aFxyXG4gICAgICByZXR1cm4gQ09NUE9ORU5UX1JFRFxyXG4gICAgaWYgZ3JlZW5MZW5ndGggPj0gcmVkTGVuZ3RoIGFuZCBncmVlbkxlbmd0aCA+PSBibHVlTGVuZ3RoXHJcbiAgICAgIHJldHVybiBDT01QT05FTlRfR1JFRU5cclxuICAgIHJldHVybiBDT01QT05FTlRfQkxVRVxyXG5cclxuICBmaW5kU3BsaXRQb2ludDogLT5cclxuICAgIGxvbmdlc3REaW1lbnNpb24gPSBAZ2V0TG9uZ2VzdENvbG9yRGltZW5zaW9uKClcclxuXHJcbiAgICBtb2RpZnlTaWduaWZpY2FudE9jdGV0IEBjb2xvcnMsIGxvbmdlc3REaW1lbnNpb24sIEBsb3dlckluZGV4LCBAdXBwZXJJbmRleFxyXG5cclxuICAgICMgLy8gTm93IHNvcnQuLi4gQXJyYXlzLnNvcnQgdXNlcyBhIGV4Y2x1c2l2ZSB0b0luZGV4IHNvIHdlIG5lZWQgdG8gYWRkIDFcclxuICAgICMgQXJyYXlzLnNvcnQoY29sb3JzLCBtTG93ZXJJbmRleCwgbVVwcGVySW5kZXggKyAxKTtcclxuICAgIHNvcnQgQGNvbG9ycywgQGxvd2VySW5kZXgsIEB1cHBlckluZGV4ICsgMVxyXG5cclxuICAgIG1vZGlmeVNpZ25pZmljYW50T2N0ZXQgQGNvbG9ycywgbG9uZ2VzdERpbWVuc2lvbiwgQGxvd2VySW5kZXgsIEB1cHBlckluZGV4XHJcblxyXG4gICAgbWlkUG9pbnQgPSBAcG9wdWxhdGlvbiAvIDJcclxuXHJcbiAgICBjb3VudCA9IDBcclxuICAgIGZvciBpIGluIFtAbG93ZXJJbmRleC4uQHVwcGVySW5kZXhdXHJcbiAgICAgIGNvdW50ICs9IEBoaXN0W0Bjb2xvcnNbaV1dXHJcbiAgICAgIGlmIGNvdW50ID49IG1pZFBvaW50XHJcbiAgICAgICAgcmV0dXJuIGlcclxuXHJcbiAgICByZXR1cm4gQGxvd2VySW5kZXhcclxuXHJcbiAgZ2V0QXZlcmFnZUNvbG9yOiAtPlxyXG4gICAgcmVkU3VtID0gZ3JlZW5TdW0gPSBibHVlU3VtID0gMFxyXG4gICAgdG90YWxQb3B1bGF0aW9uID0gMFxyXG5cclxuICAgIGZvciBpIGluIFtAbG93ZXJJbmRleC4uQHVwcGVySW5kZXhdXHJcbiAgICAgIGNvbG9yID0gQGNvbG9yc1tpXVxyXG4gICAgICBjb2xvclBvcHVsYXRpb24gPSBAaGlzdFtjb2xvcl1cclxuXHJcbiAgICAgIHRvdGFsUG9wdWxhdGlvbiArPSBjb2xvclBvcHVsYXRpb25cclxuXHJcbiAgICAgIHJlZFN1bSArPSBjb2xvclBvcHVsYXRpb24gKiBxdWFudGl6ZWRSZWQoY29sb3IpXHJcbiAgICAgIGdyZWVuU3VtICs9IGNvbG9yUG9wdWxhdGlvbiAqIHF1YW50aXplZEdyZWVuKGNvbG9yKVxyXG4gICAgICBibHVlU3VtICs9IGNvbG9yUG9wdWxhdGlvbiAqIHF1YW50aXplZEJsdWUoY29sb3IpXHJcblxyXG4gICAgcmVkTWVhbiA9IE1hdGgucm91bmQgcmVkU3VtIC8gdG90YWxQb3B1bGF0aW9uXHJcbiAgICBncmVlbk1lYW4gPSBNYXRoLnJvdW5kIGdyZWVuU3VtIC8gdG90YWxQb3B1bGF0aW9uXHJcbiAgICBibHVlTWVhbiA9IE1hdGgucm91bmQgYmx1ZVN1bSAvIHRvdGFsUG9wdWxhdGlvblxyXG5cclxuICAgIHJldHVybiBuZXcgU3dhdGNoKGFwcHJveGltYXRlVG9SZ2I4ODgocmVkTWVhbiwgZ3JlZW5NZWFuLCBibHVlTWVhbiksIHRvdGFsUG9wdWxhdGlvbilcclxuIiwiIyBTSUdCSVRTID0gNVxyXG4jIFJTSElGVCA9IDggLSBTSUdCSVRTXHJcbiNcclxuIyBnZXRDb2xvckluZGV4ID0gKHIsIGcsIGIpIC0+XHJcbiMgICAocjw8KDIqU0lHQklUUykpICsgKGcgPDwgU0lHQklUUykgKyBiXHJcblxyXG57Z2V0Q29sb3JJbmRleCwgU0lHQklUUywgUlNISUZUfSA9IHV0aWwgPSByZXF1aXJlKCcuLi8uLi91dGlsJylcclxuU3dhdGNoID0gcmVxdWlyZSgnLi4vLi4vc3dhdGNoJylcclxuVkJveCA9IHJlcXVpcmUoJy4vdmJveCcpXHJcblBRdWV1ZSA9IHJlcXVpcmUoJy4vcHF1ZXVlJylcclxuXHJcbm1vZHVsZS5leHBvcnRzID1cclxuY2xhc3MgTU1DUVxyXG4gIEBEZWZhdWx0T3B0czpcclxuICAgIG1heEl0ZXJhdGlvbnM6IDEwMDBcclxuICAgIGZyYWN0QnlQb3B1bGF0aW9uczogMC43NVxyXG5cclxuICBjb25zdHJ1Y3RvcjogKG9wdHMpIC0+XHJcbiAgICBAb3B0cyA9IHV0aWwuZGVmYXVsdHMgb3B0cywgQGNvbnN0cnVjdG9yLkRlZmF1bHRPcHRzXHJcbiAgcXVhbnRpemU6IChwaXhlbHMsIG9wdHMpIC0+XHJcbiAgICBpZiBwaXhlbHMubGVuZ3RoID09IDAgb3Igb3B0cy5jb2xvckNvdW50IDwgMiBvciBvcHRzLmNvbG9yQ291bnQgPiAyNTZcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiV3JvbmcgTU1DUSBwYXJhbWV0ZXJzXCIpXHJcblxyXG4gICAgc2hvdWxkSWdub3JlID0gLT4gZmFsc2VcclxuXHJcbiAgICBpZiBBcnJheS5pc0FycmF5KG9wdHMuZmlsdGVycykgYW5kIG9wdHMuZmlsdGVycy5sZW5ndGggPiAwXHJcbiAgICAgIHNob3VsZElnbm9yZSA9IChyLCBnLCBiLCBhKSAtPlxyXG4gICAgICAgIGZvciBmIGluIG9wdHMuZmlsdGVyc1xyXG4gICAgICAgICAgaWYgbm90IGYociwgZywgYiwgYSkgdGhlbiByZXR1cm4gdHJ1ZVxyXG4gICAgICAgIHJldHVybiBmYWxzZVxyXG5cclxuXHJcbiAgICB2Ym94ID0gVkJveC5idWlsZChwaXhlbHMsIHNob3VsZElnbm9yZSlcclxuICAgIGhpc3QgPSB2Ym94Lmhpc3RcclxuICAgIGNvbG9yQ291bnQgPSBPYmplY3Qua2V5cyhoaXN0KS5sZW5ndGhcclxuICAgIHBxID0gbmV3IFBRdWV1ZSAoYSwgYikgLT4gYS5jb3VudCgpIC0gYi5jb3VudCgpXHJcblxyXG4gICAgcHEucHVzaCh2Ym94KVxyXG5cclxuICAgICMgZmlyc3Qgc2V0IG9mIGNvbG9ycywgc29ydGVkIGJ5IHBvcHVsYXRpb25cclxuICAgIEBfc3BsaXRCb3hlcyhwcSwgQG9wdHMuZnJhY3RCeVBvcHVsYXRpb25zICogb3B0cy5jb2xvckNvdW50KVxyXG5cclxuICAgICMgUmUtb3JkZXJcclxuICAgIHBxMiA9IG5ldyBQUXVldWUgKGEsIGIpIC0+IGEuY291bnQoKSAqIGEudm9sdW1lKCkgLSBiLmNvdW50KCkgKiBiLnZvbHVtZSgpXHJcbiAgICBwcTIuY29udGVudHMgPSBwcS5jb250ZW50c1xyXG5cclxuICAgICMgbmV4dCBzZXQgLSBnZW5lcmF0ZSB0aGUgbWVkaWFuIGN1dHMgdXNpbmcgdGhlIChucGl4ICogdm9sKSBzb3J0aW5nLlxyXG4gICAgQF9zcGxpdEJveGVzKHBxMiwgb3B0cy5jb2xvckNvdW50IC0gcHEyLnNpemUoKSlcclxuXHJcbiAgICAjIGNhbGN1bGF0ZSB0aGUgYWN0dWFsIGNvbG9yc1xyXG4gICAgc3dhdGNoZXMgPSBbXVxyXG4gICAgQHZib3hlcyA9IFtdXHJcbiAgICB3aGlsZSBwcTIuc2l6ZSgpXHJcbiAgICAgIHYgPSBwcTIucG9wKClcclxuICAgICAgY29sb3IgPSB2LmF2ZygpXHJcbiAgICAgIGlmIG5vdCBzaG91bGRJZ25vcmU/KGNvbG9yWzBdLCBjb2xvclsxXSwgY29sb3JbMl0sIDI1NSlcclxuICAgICAgICBAdmJveGVzLnB1c2ggdlxyXG4gICAgICAgIHN3YXRjaGVzLnB1c2ggbmV3IFN3YXRjaCBjb2xvciwgdi5jb3VudCgpXHJcblxyXG4gICAgc3dhdGNoZXNcclxuXHJcbiAgX3NwbGl0Qm94ZXM6IChwcSwgdGFyZ2V0KSAtPlxyXG4gICAgY29sb3JDb3VudCA9IDFcclxuICAgIGl0ZXJhdGlvbiA9IDBcclxuICAgIG1heEl0ZXJhdGlvbnMgPSBAb3B0cy5tYXhJdGVyYXRpb25zXHJcbiAgICB3aGlsZSBpdGVyYXRpb24gPCBtYXhJdGVyYXRpb25zXHJcbiAgICAgIGl0ZXJhdGlvbisrXHJcbiAgICAgIHZib3ggPSBwcS5wb3AoKVxyXG4gICAgICBpZiAhdmJveC5jb3VudCgpXHJcbiAgICAgICAgY29udGludWVcclxuXHJcbiAgICAgIFt2Ym94MSwgdmJveDJdID0gdmJveC5zcGxpdCgpXHJcblxyXG4gICAgICBwcS5wdXNoKHZib3gxKVxyXG4gICAgICBpZiB2Ym94MlxyXG4gICAgICAgIHBxLnB1c2godmJveDIpXHJcbiAgICAgICAgY29sb3JDb3VudCsrXHJcbiAgICAgIGlmIGNvbG9yQ291bnQgPj0gdGFyZ2V0IG9yIGl0ZXJhdGlvbiA+IG1heEl0ZXJhdGlvbnNcclxuICAgICAgICByZXR1cm5cclxuIiwibW9kdWxlLmV4cG9ydHMgPVxyXG5jbGFzcyBQUXVldWVcclxuICBjb25zdHJ1Y3RvcjogKEBjb21wYXJhdG9yKSAtPlxyXG4gICAgQGNvbnRlbnRzID0gW11cclxuICAgIEBzb3J0ZWQgPSBmYWxzZVxyXG5cclxuICBfc29ydDogLT5cclxuICAgIEBjb250ZW50cy5zb3J0KEBjb21wYXJhdG9yKVxyXG4gICAgQHNvcnRlZCA9IHRydWVcclxuXHJcbiAgcHVzaDogKG8pIC0+XHJcbiAgICBAY29udGVudHMucHVzaCBvXHJcbiAgICBAc29ydGVkID0gZmFsc2VcclxuXHJcbiAgcGVlazogKGluZGV4KSAtPlxyXG4gICAgaWYgbm90IEBzb3J0ZWRcclxuICAgICAgQF9zb3J0KClcclxuICAgIGluZGV4ID89IEBjb250ZW50cy5sZW5ndGggLSAxXHJcbiAgICBAY29udGVudHNbaW5kZXhdXHJcblxyXG4gIHBvcDogLT5cclxuICAgIGlmIG5vdCBAc29ydGVkXHJcbiAgICAgIEBfc29ydCgpXHJcbiAgICBAY29udGVudHMucG9wKClcclxuXHJcbiAgc2l6ZTogLT5cclxuICAgIEBjb250ZW50cy5sZW5ndGhcclxuXHJcbiAgbWFwOiAoZikgLT5cclxuICAgIGlmIG5vdCBAc29ydGVkXHJcbiAgICAgIEBfc29ydCgpXHJcbiAgICBAY29udGVudHMubWFwKGYpXHJcbiIsIntnZXRDb2xvckluZGV4LCBTSUdCSVRTLCBSU0hJRlR9ID0gdXRpbCA9IHJlcXVpcmUoJy4uLy4uL3V0aWwnKVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPVxyXG5jbGFzcyBWQm94XHJcbiAgQGJ1aWxkOiAocGl4ZWxzLCBzaG91bGRJZ25vcmUpIC0+XHJcbiAgICBobiA9IDE8PCgzKlNJR0JJVFMpXHJcbiAgICBoaXN0ID0gbmV3IFVpbnQzMkFycmF5KGhuKVxyXG4gICAgcm1heCA9IGdtYXggPSBibWF4ID0gMFxyXG4gICAgcm1pbiA9IGdtaW4gPSBibWluID0gTnVtYmVyLk1BWF9WQUxVRVxyXG4gICAgbiA9IHBpeGVscy5sZW5ndGggLyA0XHJcbiAgICBpID0gMFxyXG5cclxuICAgIHdoaWxlIGkgPCBuXHJcbiAgICAgIG9mZnNldCA9IGkgKiA0XHJcbiAgICAgIGkrK1xyXG4gICAgICByID0gcGl4ZWxzW29mZnNldCArIDBdXHJcbiAgICAgIGcgPSBwaXhlbHNbb2Zmc2V0ICsgMV1cclxuICAgICAgYiA9IHBpeGVsc1tvZmZzZXQgKyAyXVxyXG4gICAgICBhID0gcGl4ZWxzW29mZnNldCArIDNdXHJcbiAgICAgICMgVE9ETzogdXNlIHJlc3VsdCBmcm9tIGhpc3RcclxuICAgICAgaWYgc2hvdWxkSWdub3JlKHIsIGcsIGIsIGEpIHRoZW4gY29udGludWVcclxuXHJcbiAgICAgIHIgPSByID4+IFJTSElGVFxyXG4gICAgICBnID0gZyA+PiBSU0hJRlRcclxuICAgICAgYiA9IGIgPj4gUlNISUZUXHJcblxyXG5cclxuICAgICAgaW5kZXggPSBnZXRDb2xvckluZGV4KHIsIGcsIGIpXHJcbiAgICAgIGhpc3RbaW5kZXhdICs9IDFcclxuXHJcbiAgICAgIGlmIHIgPiBybWF4XHJcbiAgICAgICAgcm1heCA9IHJcclxuICAgICAgaWYgciA8IHJtaW5cclxuICAgICAgICBybWluID0gclxyXG4gICAgICBpZiBnID4gZ21heFxyXG4gICAgICAgIGdtYXggPSBnXHJcbiAgICAgIGlmIGcgPCBnbWluXHJcbiAgICAgICAgZ21pbiA9IGdcclxuICAgICAgaWYgYiA+IGJtYXhcclxuICAgICAgICBibWF4ID0gYlxyXG4gICAgICBpZiBiIDwgYm1pblxyXG4gICAgICAgIGJtaW4gPSBiXHJcblxyXG4gICAgbmV3IFZCb3gocm1pbiwgcm1heCwgZ21pbiwgZ21heCwgYm1pbiwgYm1heCwgaGlzdClcclxuXHJcbiAgY29uc3RydWN0b3I6IChAcjEsIEByMiwgQGcxLCBAZzIsIEBiMSwgQGIyLCBAaGlzdCkgLT5cclxuICAgICMgQF9pbml0Qm94KClcclxuXHJcbiAgaW52YWxpZGF0ZTogLT5cclxuICAgIGRlbGV0ZSBAX2NvdW50XHJcbiAgICBkZWxldGUgQF9hdmdcclxuICAgIGRlbGV0ZSBAX3ZvbHVtZVxyXG5cclxuICB2b2x1bWU6IC0+XHJcbiAgICBpZiBub3QgQF92b2x1bWU/XHJcbiAgICAgIEBfdm9sdW1lID0gKEByMiAtIEByMSArIDEpICogKEBnMiAtIEBnMSArIDEpICogKEBiMiAtIEBiMSArIDEpXHJcbiAgICBAX3ZvbHVtZVxyXG5cclxuICBjb3VudDogLT5cclxuICAgIGlmIG5vdCBAX2NvdW50P1xyXG4gICAgICBoaXN0ID0gQGhpc3RcclxuICAgICAgYyA9IDBcclxuICAgICAgYFxyXG4gICAgICBmb3IgKHZhciByID0gdGhpcy5yMTsgciA8PSB0aGlzLnIyOyByKyspIHtcclxuICAgICAgICBmb3IgKHZhciBnID0gdGhpcy5nMTsgZyA8PSB0aGlzLmcyOyBnKyspIHtcclxuICAgICAgICAgIGZvciAodmFyIGIgPSB0aGlzLmIxOyBiIDw9IHRoaXMuYjI7IGIrKykge1xyXG4gICAgICAgICAgICB2YXIgaW5kZXggPSBnZXRDb2xvckluZGV4KHIsIGcsIGIpO1xyXG4gICAgICAgICAgICBjICs9IGhpc3RbaW5kZXhdO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgICBgXHJcbiAgICAgICMgZm9yIHIgaW4gW0ByMS4uQHIyXVxyXG4gICAgICAjICAgZm9yIGcgaW4gW0BnMS4uQGcyXVxyXG4gICAgICAjICAgICBmb3IgYiBpbiBbQGIxLi5AYjJdXHJcbiAgICAgICMgICAgICAgaW5kZXggPSBnZXRDb2xvckluZGV4KHIsIGcsIGIpXHJcbiAgICAgICMgICAgICAgYyArPSBoaXN0W2luZGV4XVxyXG4gICAgICBAX2NvdW50ID0gY1xyXG4gICAgQF9jb3VudFxyXG5cclxuICBjbG9uZTogLT5cclxuICAgIG5ldyBWQm94KEByMSwgQHIyLCBAZzEsIEBnMiwgQGIxLCBAYjIsIEBoaXN0KVxyXG5cclxuICBhdmc6IC0+XHJcbiAgICBpZiBub3QgQF9hdmc/XHJcbiAgICAgIGhpc3QgPSBAaGlzdFxyXG4gICAgICBudG90ID0gMFxyXG4gICAgICBtdWx0ID0gMSA8PCAoOCAtIFNJR0JJVFMpXHJcbiAgICAgIHJzdW0gPSBnc3VtID0gYnN1bSA9IDBcclxuICAgICAgYFxyXG4gICAgICBmb3IgKHZhciByID0gdGhpcy5yMTsgciA8PSB0aGlzLnIyOyByKyspIHtcclxuICAgICAgICBmb3IgKHZhciBnID0gdGhpcy5nMTsgZyA8PSB0aGlzLmcyOyBnKyspIHtcclxuICAgICAgICAgIGZvciAodmFyIGIgPSB0aGlzLmIxOyBiIDw9IHRoaXMuYjI7IGIrKykge1xyXG4gICAgICAgICAgICB2YXIgaW5kZXggPSBnZXRDb2xvckluZGV4KHIsIGcsIGIpO1xyXG4gICAgICAgICAgICB2YXIgaCA9IGhpc3RbaW5kZXhdO1xyXG4gICAgICAgICAgICBudG90ICs9IGg7XHJcbiAgICAgICAgICAgIHJzdW0gKz0gKGggKiAociArIDAuNSkgKiBtdWx0KTtcclxuICAgICAgICAgICAgZ3N1bSArPSAoaCAqIChnICsgMC41KSAqIG11bHQpO1xyXG4gICAgICAgICAgICBic3VtICs9IChoICogKGIgKyAwLjUpICogbXVsdCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIGBcclxuICAgICAgIyBOT1RFOiBDb2ZmZWVTY3JpcHQgd2lsbCBzY3JldyB0aGluZ3MgdXAgd2hlbiBAcjEgPiBAcjJcclxuICAgICAgIyBmb3IgciBpbiBbQHIxLi5AcjJdXHJcbiAgICAgICMgICBmb3IgZyBpbiBbQGcxLi5AZzJdXHJcbiAgICAgICMgICAgIGZvciBiIGluIFtAYjEuLkBiMl1cclxuICAgICAgIyAgICAgICBpbmRleCA9IGdldENvbG9ySW5kZXgociwgZywgYilcclxuICAgICAgIyAgICAgICBoID0gaGlzdFtpbmRleF1cclxuICAgICAgIyAgICAgICBudG90ICs9IGhcclxuICAgICAgIyAgICAgICByc3VtICs9IChoICogKHIgKyAwLjUpICogbXVsdClcclxuICAgICAgIyAgICAgICBnc3VtICs9IChoICogKGcgKyAwLjUpICogbXVsdClcclxuICAgICAgIyAgICAgICBic3VtICs9IChoICogKGIgKyAwLjUpICogbXVsdClcclxuXHJcbiAgICAgIGlmIG50b3RcclxuICAgICAgICBAX2F2ZyA9IFtcclxuICAgICAgICAgIH5+KHJzdW0gLyBudG90KVxyXG4gICAgICAgICAgfn4oZ3N1bSAvIG50b3QpXHJcbiAgICAgICAgICB+fihic3VtIC8gbnRvdClcclxuICAgICAgICBdXHJcbiAgICAgIGVsc2VcclxuICAgICAgICBAX2F2ZyA9IFtcclxuICAgICAgICAgIH5+KG11bHQgKiAoQHIxICsgQHIyICsgMSkgLyAyKVxyXG4gICAgICAgICAgfn4obXVsdCAqIChAZzEgKyBAZzIgKyAxKSAvIDIpXHJcbiAgICAgICAgICB+fihtdWx0ICogKEBiMSArIEBiMiArIDEpIC8gMilcclxuICAgICAgICBdXHJcbiAgICBAX2F2Z1xyXG5cclxuICBzcGxpdDogLT5cclxuICAgIGhpc3QgPSBAaGlzdFxyXG4gICAgaWYgIUBjb3VudCgpXHJcbiAgICAgIHJldHVybiBudWxsXHJcbiAgICBpZiBAY291bnQoKSA9PSAxXHJcbiAgICAgIHJldHVybiBbQGNsb25lKCldXHJcblxyXG4gICAgcncgPSBAcjIgLSBAcjEgKyAxXHJcbiAgICBndyA9IEBnMiAtIEBnMSArIDFcclxuICAgIGJ3ID0gQGIyIC0gQGIxICsgMVxyXG5cclxuICAgIG1heHcgPSBNYXRoLm1heChydywgZ3csIGJ3KVxyXG4gICAgYWNjU3VtID0gbnVsbFxyXG4gICAgc3VtID0gdG90YWwgPSAwXHJcblxyXG4gICAgbWF4ZCA9IG51bGxcclxuICAgIHN3aXRjaCBtYXh3XHJcbiAgICAgIHdoZW4gcndcclxuICAgICAgICBtYXhkID0gJ3InXHJcbiAgICAgICAgYWNjU3VtID0gbmV3IFVpbnQzMkFycmF5KEByMiArIDEpXHJcbiAgICAgICAgYFxyXG4gICAgICAgIGZvciAodmFyIHIgPSB0aGlzLnIxOyByIDw9IHRoaXMucjI7IHIrKykge1xyXG4gICAgICAgICAgc3VtID0gMFxyXG4gICAgICAgICAgZm9yICh2YXIgZyA9IHRoaXMuZzE7IGcgPD0gdGhpcy5nMjsgZysrKSB7XHJcbiAgICAgICAgICAgIGZvciAodmFyIGIgPSB0aGlzLmIxOyBiIDw9IHRoaXMuYjI7IGIrKykge1xyXG4gICAgICAgICAgICAgIHZhciBpbmRleCA9IGdldENvbG9ySW5kZXgociwgZywgYik7XHJcbiAgICAgICAgICAgICAgc3VtICs9IGhpc3RbaW5kZXhdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICB0b3RhbCArPSBzdW07XHJcbiAgICAgICAgICBhY2NTdW1bcl0gPSB0b3RhbDtcclxuICAgICAgICB9XHJcbiAgICAgICAgYFxyXG4gICAgICAgICMgZm9yIHIgaW4gW0ByMS4uQHIyXVxyXG4gICAgICAgICMgICBzdW0gPSAwXHJcbiAgICAgICAgIyAgIGZvciBnIGluIFtAZzEuLkBnMl1cclxuICAgICAgICAjICAgICBmb3IgYiBpbiBbQGIxLi5AYjJdXHJcbiAgICAgICAgIyAgICAgICBpbmRleCA9IGdldENvbG9ySW5kZXgociwgZywgYilcclxuICAgICAgICAjICAgICAgIHN1bSArPSBoaXN0W2luZGV4XVxyXG4gICAgICAgICMgICB0b3RhbCArPSBzdW1cclxuICAgICAgICAjICAgYWNjU3VtW3JdID0gdG90YWxcclxuICAgICAgd2hlbiBnd1xyXG4gICAgICAgIG1heGQgPSAnZydcclxuICAgICAgICBhY2NTdW0gPSBuZXcgVWludDMyQXJyYXkoQGcyICsgMSlcclxuICAgICAgICBgXHJcbiAgICAgICAgZm9yICh2YXIgZyA9IHRoaXMuZzE7IGcgPD0gdGhpcy5nMjsgZysrKSB7XHJcbiAgICAgICAgICBzdW0gPSAwXHJcbiAgICAgICAgICBmb3IgKHZhciByID0gdGhpcy5yMTsgciA8PSB0aGlzLnIyOyByKyspIHtcclxuICAgICAgICAgICAgZm9yICh2YXIgYiA9IHRoaXMuYjE7IGIgPD0gdGhpcy5iMjsgYisrKSB7XHJcbiAgICAgICAgICAgICAgdmFyIGluZGV4ID0gZ2V0Q29sb3JJbmRleChyLCBnLCBiKTtcclxuICAgICAgICAgICAgICBzdW0gKz0gaGlzdFtpbmRleF07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH1cclxuICAgICAgICAgIHRvdGFsICs9IHN1bTtcclxuICAgICAgICAgIGFjY1N1bVtnXSA9IHRvdGFsO1xyXG4gICAgICAgIH1cclxuICAgICAgICBgXHJcbiAgICAgICAgIyBmb3IgZyBpbiBbQGcxLi5AZzJdXHJcbiAgICAgICAgIyAgIHN1bSA9IDBcclxuICAgICAgICAjICAgZm9yIHIgaW4gW0ByMS4uQHIyXVxyXG4gICAgICAgICMgICAgIGZvciBiIGluIFtAYjEuLkBiMl1cclxuICAgICAgICAjICAgICAgIGluZGV4ID0gZ2V0Q29sb3JJbmRleChyLCBnLCBiKVxyXG4gICAgICAgICMgICAgICAgc3VtICs9IGhpc3RbaW5kZXhdXHJcbiAgICAgICAgIyAgIHRvdGFsICs9IHN1bVxyXG4gICAgICAgICMgICBhY2NTdW1bZ10gPSB0b3RhbFxyXG4gICAgICB3aGVuIGJ3XHJcbiAgICAgICAgbWF4ZCA9ICdiJ1xyXG4gICAgICAgIGFjY1N1bSA9IG5ldyBVaW50MzJBcnJheShAYjIgKyAxKVxyXG4gICAgICAgIGBcclxuICAgICAgICBmb3IgKHZhciBiID0gdGhpcy5iMTsgYiA8PSB0aGlzLmIyOyBiKyspIHtcclxuICAgICAgICAgIHN1bSA9IDBcclxuICAgICAgICAgIGZvciAodmFyIHIgPSB0aGlzLnIxOyByIDw9IHRoaXMucjI7IHIrKykge1xyXG4gICAgICAgICAgICBmb3IgKHZhciBnID0gdGhpcy5nMTsgZyA8PSB0aGlzLmcyOyBnKyspIHtcclxuICAgICAgICAgICAgICB2YXIgaW5kZXggPSBnZXRDb2xvckluZGV4KHIsIGcsIGIpO1xyXG4gICAgICAgICAgICAgIHN1bSArPSBoaXN0W2luZGV4XTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgdG90YWwgKz0gc3VtO1xyXG4gICAgICAgICAgYWNjU3VtW2JdID0gdG90YWw7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGBcclxuICAgICAgICAjIGZvciBiIGluIFtAYjEuLkBiMl1cclxuICAgICAgICAjICAgc3VtID0gMFxyXG4gICAgICAgICMgICBmb3IgciBpbiBbQHIxLi5AcjJdXHJcbiAgICAgICAgIyAgICAgZm9yIGcgaW4gW0BnMS4uQGcyXVxyXG4gICAgICAgICMgICAgICAgaW5kZXggPSBnZXRDb2xvckluZGV4KHIsIGcsIGIpXHJcbiAgICAgICAgIyAgICAgICBzdW0gKz0gaGlzdFtpbmRleF1cclxuICAgICAgICAjICAgdG90YWwgKz0gc3VtXHJcbiAgICAgICAgIyAgIGFjY1N1bVtiXSA9IHRvdGFsXHJcblxyXG4gICAgc3BsaXRQb2ludCA9IC0xXHJcbiAgICByZXZlcnNlU3VtID0gbmV3IFVpbnQzMkFycmF5KGFjY1N1bS5sZW5ndGgpXHJcbiAgICBmb3IgaSBpbiBbMC4uYWNjU3VtLmxlbmd0aC0xXVxyXG4gICAgICBkID0gYWNjU3VtW2ldXHJcbiAgICAgIGlmIHNwbGl0UG9pbnQgPCAwICYmIGQgPiB0b3RhbCAvIDJcclxuICAgICAgICBzcGxpdFBvaW50ID0gaVxyXG4gICAgICByZXZlcnNlU3VtW2ldID0gdG90YWwgLSBkXHJcblxyXG4gICAgdmJveCA9IHRoaXNcclxuICAgIGRvQ3V0ID0gKGQpIC0+XHJcbiAgICAgIGRpbTEgPSBkICsgXCIxXCJcclxuICAgICAgZGltMiA9IGQgKyBcIjJcIlxyXG4gICAgICBkMSA9IHZib3hbZGltMV1cclxuICAgICAgZDIgPSB2Ym94W2RpbTJdXHJcbiAgICAgIHZib3gxID0gdmJveC5jbG9uZSgpXHJcbiAgICAgIHZib3gyID0gdmJveC5jbG9uZSgpXHJcbiAgICAgIGxlZnQgPSBzcGxpdFBvaW50IC0gZDFcclxuICAgICAgcmlnaHQgPSBkMiAtIHNwbGl0UG9pbnRcclxuICAgICAgaWYgbGVmdCA8PSByaWdodFxyXG4gICAgICAgIGQyID0gTWF0aC5taW4oZDIgLSAxLCB+fiAoc3BsaXRQb2ludCArIHJpZ2h0IC8gMikpXHJcbiAgICAgICAgZDIgPSBNYXRoLm1heCgwLCBkMilcclxuICAgICAgZWxzZVxyXG4gICAgICAgIGQyID0gTWF0aC5tYXgoZDEsIH5+IChzcGxpdFBvaW50IC0gMSAtIGxlZnQgLyAyKSlcclxuICAgICAgICBkMiA9IE1hdGgubWluKHZib3hbZGltMl0sIGQyKVxyXG5cclxuXHJcbiAgICAgIHdoaWxlICFhY2NTdW1bZDJdXHJcbiAgICAgICAgZDIrK1xyXG5cclxuXHJcbiAgICAgIGMyID0gcmV2ZXJzZVN1bVtkMl1cclxuICAgICAgd2hpbGUgIWMyIGFuZCBhY2NTdW1bZDIgLSAxXVxyXG4gICAgICAgIGMyID0gcmV2ZXJzZVN1bVstLWQyXVxyXG5cclxuICAgICAgdmJveDFbZGltMl0gPSBkMlxyXG4gICAgICB2Ym94MltkaW0xXSA9IGQyICsgMVxyXG4gICAgICAjIHZib3guaW52YWxpZGF0ZSgpXHJcblxyXG4gICAgICByZXR1cm4gW3Zib3gxLCB2Ym94Ml1cclxuXHJcbiAgICBkb0N1dCBtYXhkXHJcblxyXG4gIGNvbnRhaW5zOiAocCkgLT5cclxuICAgIHIgPSBwWzBdPj5SU0hJRlRcclxuICAgIGcgPSBwWzFdPj5SU0hJRlRcclxuICAgIGIgPSBwWzJdPj5SU0hJRlRcclxuXHJcbiAgICByID49IEByMSBhbmQgciA8PSBAcjIgYW5kIGcgPj0gQGcxIGFuZCBnIDw9IEBnMiBhbmQgYiA+PSBAYjEgYW5kIGIgPD0gQGIyXHJcbiIsIm1vZHVsZS5leHBvcnRzID1cclxuY2xhc3MgUXVhbnRpemVyXHJcbiAgaW5pdGlhbGl6ZTogKHBpeGVscywgb3B0cykgLT5cclxuXHJcbiAgZ2V0UXVhbnRpemVkQ29sb3JzOiAtPlxyXG5cclxubW9kdWxlLmV4cG9ydHMuQmFzZWxpbmUgPSByZXF1aXJlKCcuL2Jhc2VsaW5lJylcclxubW9kdWxlLmV4cG9ydHMuTm9Db3B5ID0gcmVxdWlyZSgnLi9ub2NvcHknKVxyXG5tb2R1bGUuZXhwb3J0cy5Db2xvckN1dCA9IHJlcXVpcmUoJy4vY29sb3ItY3V0JylcclxubW9kdWxlLmV4cG9ydHMuTU1DUSA9IHJlcXVpcmUoJy4vbW1jcScpXHJcbiIsIlN3YXRjaCA9IHJlcXVpcmUoJy4uL3N3YXRjaCcpXHJcblF1YW50aXplciA9IHJlcXVpcmUoJy4vaW5kZXgnKVxyXG5NTUNRSW1wbCA9IHJlcXVpcmUoJy4vaW1wbC9tbWNxJylcclxuXHJcbm1vZHVsZS5leHBvcnRzID1cclxuY2xhc3MgTU1DUSBleHRlbmRzIFF1YW50aXplclxyXG4gIGluaXRpYWxpemU6IChwaXhlbHMsIEBvcHRzKSAtPlxyXG4gICAgbW1jcSA9IG5ldyBNTUNRSW1wbCgpXHJcbiAgICBAc3dhdGNoZXMgPSBtbWNxLnF1YW50aXplIHBpeGVscywgQG9wdHNcclxuXHJcbiAgZ2V0UXVhbnRpemVkQ29sb3JzOiAtPlxyXG4gICAgQHN3YXRjaGVzXHJcbiIsIlN3YXRjaCA9IHJlcXVpcmUoJy4uL3N3YXRjaCcpXHJcblF1YW50aXplciA9IHJlcXVpcmUoJy4vaW5kZXgnKVxyXG5xdWFudGl6ZSA9IHJlcXVpcmUoJy4uLy4uL3ZlbmRvci1tb2QvcXVhbnRpemUnKVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPVxyXG5jbGFzcyBOb0NvcHlRdWFudGl6ZXIgZXh0ZW5kcyBRdWFudGl6ZXJcclxuICBpbml0aWFsaXplOiAocGl4ZWxzLCBAb3B0cykgLT5cclxuICAgIGNtYXAgPSBxdWFudGl6ZSBwaXhlbHMsIEBvcHRzXHJcbiAgICBAc3dhdGNoZXMgPSBjbWFwLnZib3hlcy5tYXAgKHZib3gpID0+XHJcbiAgICAgIG5ldyBTd2F0Y2ggdmJveC5jb2xvciwgdmJveC52Ym94LmNvdW50KClcclxuXHJcbiAgZ2V0UXVhbnRpemVkQ29sb3JzOiAtPlxyXG4gICAgQHN3YXRjaGVzXHJcbiIsInV0aWwgPSByZXF1aXJlKCcuL3V0aWwnKVxuQ29sb3IgPSB1dGlsLkNvbG9yXG4jIyNcbiAgRnJvbSBWaWJyYW50LmpzIGJ5IEphcmkgWndhcnRzXG4gIFBvcnRlZCB0byBub2RlLmpzIGJ5IEFLRmlzaFxuXG4gIFN3YXRjaCBjbGFzc1xuIyMjXG5cbk1JTl9DT05UUkFTVF9USVRMRV9URVhUID0gMy4wXG5NSU5fQ09OVFJBU1RfQk9EWV9URVhUID0gNC41XG5cbm1vZHVsZS5leHBvcnRzID1cblxuY2xhc3MgU3dhdGNoXG4gIGhzbDogdW5kZWZpbmVkXG4gIHJnYjogdW5kZWZpbmVkXG4gIHBvcHVsYXRpb246IDFcbiAgeWlxOiAwXG5cbiAgY29uc3RydWN0b3I6IChyZ2IsIHBvcHVsYXRpb24pIC0+XG4gICAgQHJnYiA9IHJnYlxuICAgIEBwb3B1bGF0aW9uID0gcG9wdWxhdGlvblxuXG4gIGdldEhzbDogLT5cbiAgICBpZiBub3QgQGhzbFxuICAgICAgQGhzbCA9IHV0aWwucmdiVG9Ic2wgQHJnYlswXSwgQHJnYlsxXSwgQHJnYlsyXVxuICAgIGVsc2UgQGhzbFxuXG4gIGdldFBvcHVsYXRpb246IC0+XG4gICAgQHBvcHVsYXRpb25cblxuICBnZXRSZ2I6IC0+XG4gICAgQHJnYlxuXG4gIGdldEhleDogLT5cbiAgICB1dGlsLnJnYlRvSGV4KEByZ2JbMF0sIEByZ2JbMV0sIEByZ2JbMl0pXG5cbiAgZ2V0VGl0bGVUZXh0Q29sb3I6IC0+XG4gICAgQF9lbnN1cmVUZXh0Q29sb3JzKClcbiAgICBAdGl0bGVUZXh0Q29sb3JcblxuICBnZXRCb2R5VGV4dENvbG9yOiAtPlxuICAgIEBfZW5zdXJlVGV4dENvbG9ycygpXG4gICAgQGJvZHlUZXh0Q29sb3JcblxuICBfZW5zdXJlVGV4dENvbG9yczogLT5cbiAgICBpZiBub3QgQGdlbmVyYXRlZFRleHRDb2xvcnNcbiAgICAgICMgdGV4dCBjb2xvcnMgYXJlIG9mIGtpbmQgW2FscGhhLCByLCBnLCBiXVxuICAgICAgIyBAdGl0bGVUZXh0Q29sb3IgPSB1dGlsLmdldFRleHRDb2xvckZvckJhY2tncm91bmQgQHJnYiwgTUlOX0NPTlRSQVNUX1RJVExFX1RFWFRcbiAgICAgICMgQGJvZHlUZXh0Q29sb3IgPSB1dGlsLmdldFRleHRDb2xvckZvckJhY2tncm91bmQgQHJnYiwgTUlOX0NPTlRSQVNUX0JPRFlfVEVYVFxuXG4gICAgICBhcmdiID0gWzI1NSwgQHJnYlswXSwgQHJnYlswXSwgQHJnYlswXV1cblxuICAgICAgbGlnaHRCb2R5QWxwaGEgPSB1dGlsLmNhbGN1bGF0ZU1pbmltdW1BbHBoYSBDb2xvci5XSElURSwgYXJnYiwgTUlOX0NPTlRSQVNUX0JPRFlfVEVYVFxuICAgICAgbGlnaHRUaXRsZUFscGhhID0gdXRpbC5jYWxjdWxhdGVNaW5pbXVtQWxwaGEgQ29sb3IuV0hJVEUsIGFyZ2IsIE1JTl9DT05UUkFTVF9USVRMRV9URVhUXG5cbiAgICAgIGlmIChsaWdodEJvZHlBbHBoYSAhPSAtMSkgJiYgKGxpZ2h0VGl0bGVBbHBoYSAhPSAtMSlcbiAgICAgICAgICAjIElmIHdlIGZvdW5kIHZhbGlkIGxpZ2h0IHZhbHVlcywgdXNlIHRoZW0gYW5kIHJldHVyblxuICAgICAgICAgIEBib2R5VGV4dENvbG9yID0gdXRpbC5zZXRBbHBoYUNvbXBvbmVudCBDb2xvci5XSElURSwgbGlnaHRCb2R5QWxwaGFcbiAgICAgICAgICBAdGl0bGVUZXh0Q29sb3IgPSB1dGlsLnNldEFscGhhQ29tcG9uZW50IENvbG9yLldISVRFLCBsaWdodFRpdGxlQWxwaGFcbiAgICAgICAgICBAZ2VuZXJhdGVkVGV4dENvbG9ycyA9IHRydWVcbiAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkXG5cbiAgICAgIGRhcmtCb2R5QWxwaGEgPSB1dGlsLmNhbGN1bGF0ZU1pbmltdW1BbHBoYSBDb2xvci5CTEFDSywgYXJnYiwgTUlOX0NPTlRSQVNUX0JPRFlfVEVYVFxuICAgICAgZGFya1RpdGxlQWxwaGEgPSB1dGlsLmNhbGN1bGF0ZU1pbmltdW1BbHBoYSBDb2xvci5CTEFDSywgYXJnYiwgTUlOX0NPTlRSQVNUX1RJVExFX1RFWFRcblxuICAgICAgaWYgKGRhcmtCb2R5QWxwaGEgIT0gLTEpICYmIChkYXJrQm9keUFscGhhICE9IC0xKVxuICAgICAgICAgICMgSWYgd2UgZm91bmQgdmFsaWQgZGFyayB2YWx1ZXMsIHVzZSB0aGVtIGFuZCByZXR1cm5cbiAgICAgICAgICBAYm9keVRleHRDb2xvciA9IHV0aWwuc2V0QWxwaGFDb21wb25lbnQgQ29sb3IuQkxBQ0ssIGRhcmtCb2R5QWxwaGFcbiAgICAgICAgICBAdGl0bGVUZXh0Q29sb3IgPSB1dGlsLnNldEFscGhhQ29tcG9uZW50IENvbG9yLkJMQUNLLCBkYXJrVGl0bGVBbHBoYVxuICAgICAgICAgIEBnZW5lcmF0ZWRUZXh0Q29sb3JzID0gdHJ1ZVxuICAgICAgICAgIHJldHVybiB1bmRlZmluZWRcblxuICAgICAgY29uc29sZS5sb2dcbiAgICAgIGNvbnNvbGUubG9nXG4gICAgICBjb25zb2xlLmxvZyAnQGJvZHlUZXh0Q29sb3InXG4gICAgICBjb25zb2xlLmxvZyBAYm9keVRleHRDb2xvclxuICAgICAgY29uc29sZS5sb2dcbiAgICAgIGNvbnNvbGUubG9nICdAdGl0bGVUZXh0Q29sb3InXG4gICAgICBjb25zb2xlLmxvZyBAdGl0bGVUZXh0Q29sb3JcbiAgICAgIGNvbnNvbGUubG9nXG4gICAgICBjb25zb2xlLmxvZ1xuXG4gICAgICAjIElmIHdlIHJlYWNoIGhlcmUgdGhlbiB3ZSBjYW4gbm90IGZpbmQgdGl0bGUgYW5kIGJvZHkgdmFsdWVzIHdoaWNoIHVzZSB0aGUgc2FtZVxuICAgICAgIyBsaWdodG5lc3MsIHdlIG5lZWQgdG8gdXNlIG1pc21hdGNoZWQgdmFsdWVzXG4gICAgICBAYm9keVRleHRDb2xvciA9IGlmIGxpZ2h0Qm9keUFscGhhICE9IC0xIHRoZW4gdXRpbC5zZXRBbHBoYUNvbXBvbmVudCBDb2xvci5XSElURSwgbGlnaHRCb2R5QWxwaGEgZWxzZSB1dGlsLnNldEFscGhhQ29tcG9uZW50IENvbG9yLkJMQUNLLCBkYXJrQm9keUFscGhhXG4gICAgICBAdGl0bGVUZXh0Q29sb3IgPSBpZiBsaWdodFRpdGxlQWxwaGEgIT0gLTEgdGhlbiB1dGlsLnNldEFscGhhQ29tcG9uZW50IENvbG9yLldISVRFLCBsaWdodFRpdGxlQWxwaGEgZWxzZSB1dGlsLnNldEFscGhhQ29tcG9uZW50IENvbG9yLkJMQUNLLCBkYXJrVGl0bGVBbHBoYVxuXG4gICAgICBAZ2VuZXJhdGVkVGV4dENvbG9ycyA9IHRydWVcbiIsIkRFTFRBRTk0ID1cbiAgTkE6IDBcbiAgUEVSRkVDVDogMVxuICBDTE9TRTogMlxuICBHT09EOiAxMFxuICBTSU1JTEFSOiA1MFxuXG5TSUdCSVRTID0gNVxuUlNISUZUID0gOCAtIFNJR0JJVFNcblxuXG5NSU5fQUxQSEFfU0VBUkNIX01BWF9JVEVSQVRJT05TID0gMTA7XG5NSU5fQUxQSEFfU0VBUkNIX1BSRUNJU0lPTiA9IDEwO1xuXG4jIGFyZ2ItY29sb3IgdXRpbDpcbkNvbG9yID1cbiAgV0hJVEU6IFsyNTUsIDI1NSwgMjU1LCAyNTVdXG4gIEJMQUNLOiBbMjU1LCAwLCAwLCAwXVxuICBhbHBoYTogKGFyZ2IpIC0+XG4gICAgYXJnYlswXVxuICByZWQ6IChhcmdiKSAtPlxuICAgIGFyZ2JbMV1cbiAgZ3JlZW46IChhcmdiKSAtPlxuICAgIGFyZ2JbMl1cbiAgYmx1ZTogKGFyZ2IpIC0+XG4gICAgYXJnYlszXVxuICBhcmdiOiAoYSwgciwgZywgYikgLT5cbiAgICBbYSwgciwgZywgYl1cblxuXG5tb2R1bGUuZXhwb3J0cyA9XG4gIGNsb25lOiAobykgLT5cbiAgICBpZiB0eXBlb2YgbyA9PSAnb2JqZWN0J1xuICAgICAgaWYgQXJyYXkuaXNBcnJheSBvXG4gICAgICAgIHJldHVybiBvLm1hcCAodikgPT4gdGhpcy5jbG9uZSB2XG4gICAgICBlbHNlXG4gICAgICAgIF9vID0ge31cbiAgICAgICAgZm9yIGtleSwgdmFsdWUgb2Ygb1xuICAgICAgICAgIF9vW2tleV0gPSB0aGlzLmNsb25lIHZhbHVlXG4gICAgICAgIHJldHVybiBfb1xuICAgIG9cblxuICBkZWZhdWx0czogKCkgLT5cbiAgICBvID0ge31cbiAgICBmb3IgX28gaW4gYXJndW1lbnRzXG4gICAgICBmb3Iga2V5LCB2YWx1ZSBvZiBfb1xuICAgICAgICBpZiBub3Qgb1trZXldPyB0aGVuIG9ba2V5XSA9IHRoaXMuY2xvbmUgdmFsdWVcblxuICAgIG9cblxuICBoZXhUb1JnYjogKGhleCkgLT5cbiAgICBtID0gL14jPyhbYS1mXFxkXXsyfSkoW2EtZlxcZF17Mn0pKFthLWZcXGRdezJ9KSQvaS5leGVjKGhleClcbiAgICBpZiBtP1xuICAgICAgcmV0dXJuIFttWzFdLCBtWzJdLCBtWzNdXS5tYXAgKHMpIC0+IHBhcnNlSW50KHMsIDE2KVxuICAgIHJldHVybiBudWxsXG5cbiAgcmdiVG9IZXg6IChyLCBnLCBiKSAtPlxuICAgIFwiI1wiICsgKCgxIDw8IDI0KSArIChyIDw8IDE2KSArIChnIDw8IDgpICsgYikudG9TdHJpbmcoMTYpLnNsaWNlKDEsIDcpXG5cbiAgcmdiVG9Ic2w6IChyLCBnLCBiKSAtPlxuICAgIHIgLz0gMjU1XG4gICAgZyAvPSAyNTVcbiAgICBiIC89IDI1NVxuICAgIG1heCA9IE1hdGgubWF4KHIsIGcsIGIpXG4gICAgbWluID0gTWF0aC5taW4ociwgZywgYilcbiAgICBoID0gdW5kZWZpbmVkXG4gICAgcyA9IHVuZGVmaW5lZFxuICAgIGwgPSAobWF4ICsgbWluKSAvIDJcbiAgICBpZiBtYXggPT0gbWluXG4gICAgICBoID0gcyA9IDBcbiAgICAgICMgYWNocm9tYXRpY1xuICAgIGVsc2VcbiAgICAgIGQgPSBtYXggLSBtaW5cbiAgICAgIHMgPSBpZiBsID4gMC41IHRoZW4gZCAvICgyIC0gbWF4IC0gbWluKSBlbHNlIGQgLyAobWF4ICsgbWluKVxuICAgICAgc3dpdGNoIG1heFxuICAgICAgICB3aGVuIHJcbiAgICAgICAgICBoID0gKGcgLSBiKSAvIGQgKyAoaWYgZyA8IGIgdGhlbiA2IGVsc2UgMClcbiAgICAgICAgd2hlbiBnXG4gICAgICAgICAgaCA9IChiIC0gcikgLyBkICsgMlxuICAgICAgICB3aGVuIGJcbiAgICAgICAgICBoID0gKHIgLSBnKSAvIGQgKyA0XG4gICAgICBoIC89IDZcbiAgICBbaCwgcywgbF1cblxuICBoc2xUb1JnYjogKGgsIHMsIGwpIC0+XG4gICAgciA9IHVuZGVmaW5lZFxuICAgIGcgPSB1bmRlZmluZWRcbiAgICBiID0gdW5kZWZpbmVkXG5cbiAgICBodWUycmdiID0gKHAsIHEsIHQpIC0+XG4gICAgICBpZiB0IDwgMFxuICAgICAgICB0ICs9IDFcbiAgICAgIGlmIHQgPiAxXG4gICAgICAgIHQgLT0gMVxuICAgICAgaWYgdCA8IDEgLyA2XG4gICAgICAgIHJldHVybiBwICsgKHEgLSBwKSAqIDYgKiB0XG4gICAgICBpZiB0IDwgMSAvIDJcbiAgICAgICAgcmV0dXJuIHFcbiAgICAgIGlmIHQgPCAyIC8gM1xuICAgICAgICByZXR1cm4gcCArIChxIC0gcCkgKiAoMiAvIDMgLSB0KSAqIDZcbiAgICAgIHBcblxuICAgIGlmIHMgPT0gMFxuICAgICAgciA9IGcgPSBiID0gbFxuICAgICAgIyBhY2hyb21hdGljXG4gICAgZWxzZVxuICAgICAgcSA9IGlmIGwgPCAwLjUgdGhlbiBsICogKDEgKyBzKSBlbHNlIGwgKyBzIC0gKGwgKiBzKVxuICAgICAgcCA9IDIgKiBsIC0gcVxuICAgICAgciA9IGh1ZTJyZ2IocCwgcSwgaCArIDEgLyAzKVxuICAgICAgZyA9IGh1ZTJyZ2IocCwgcSwgaClcbiAgICAgIGIgPSBodWUycmdiKHAsIHEsIGggLSAoMSAvIDMpKVxuICAgIFtcbiAgICAgIHIgKiAyNTVcbiAgICAgIGcgKiAyNTVcbiAgICAgIGIgKiAyNTVcbiAgICBdXG5cbiAgcmdiVG9YeXo6IChyLCBnLCBiKSAtPlxuICAgIHIgLz0gMjU1XG4gICAgZyAvPSAyNTVcbiAgICBiIC89IDI1NVxuICAgIHIgPSBpZiByID4gMC4wNDA0NSB0aGVuIE1hdGgucG93KChyICsgMC4wMDUpIC8gMS4wNTUsIDIuNCkgZWxzZSByIC8gMTIuOTJcbiAgICBnID0gaWYgZyA+IDAuMDQwNDUgdGhlbiBNYXRoLnBvdygoZyArIDAuMDA1KSAvIDEuMDU1LCAyLjQpIGVsc2UgZyAvIDEyLjkyXG4gICAgYiA9IGlmIGIgPiAwLjA0MDQ1IHRoZW4gTWF0aC5wb3coKGIgKyAwLjAwNSkgLyAxLjA1NSwgMi40KSBlbHNlIGIgLyAxMi45MlxuXG4gICAgciAqPSAxMDBcbiAgICBnICo9IDEwMFxuICAgIGIgKj0gMTAwXG5cbiAgICB4ID0gciAqIDAuNDEyNCArIGcgKiAwLjM1NzYgKyBiICogMC4xODA1XG4gICAgeSA9IHIgKiAwLjIxMjYgKyBnICogMC43MTUyICsgYiAqIDAuMDcyMlxuICAgIHogPSByICogMC4wMTkzICsgZyAqIDAuMTE5MiArIGIgKiAwLjk1MDVcblxuICAgIFt4LCB5LCB6XVxuXG4gIHh5elRvQ0lFTGFiOiAoeCwgeSwgeikgLT5cbiAgICBSRUZfWCA9IDk1LjA0N1xuICAgIFJFRl9ZID0gMTAwXG4gICAgUkVGX1ogPSAxMDguODgzXG5cbiAgICB4IC89IFJFRl9YXG4gICAgeSAvPSBSRUZfWVxuICAgIHogLz0gUkVGX1pcblxuICAgIHggPSBpZiB4ID4gMC4wMDg4NTYgdGhlbiBNYXRoLnBvdyh4LCAxLzMpIGVsc2UgNy43ODcgKiB4ICsgMTYgLyAxMTZcbiAgICB5ID0gaWYgeSA+IDAuMDA4ODU2IHRoZW4gTWF0aC5wb3coeSwgMS8zKSBlbHNlIDcuNzg3ICogeSArIDE2IC8gMTE2XG4gICAgeiA9IGlmIHogPiAwLjAwODg1NiB0aGVuIE1hdGgucG93KHosIDEvMykgZWxzZSA3Ljc4NyAqIHogKyAxNiAvIDExNlxuXG4gICAgTCA9IDExNiAqIHkgLSAxNlxuICAgIGEgPSA1MDAgKiAoeCAtIHkpXG4gICAgYiA9IDIwMCAqICh5IC0geilcblxuICAgIFtMLCBhLCBiXVxuXG4gIHJnYlRvQ0lFTGFiOiAociwgZywgYikgLT5cbiAgICBbeCwgeSwgel0gPSB0aGlzLnJnYlRvWHl6IHIsIGcsIGJcbiAgICB0aGlzLnh5elRvQ0lFTGFiIHgsIHksIHpcblxuICBkZWx0YUU5NDogKGxhYjEsIGxhYjIpIC0+XG4gICAgIyBXZWlnaHRzXG4gICAgV0VJR0hUX0wgPSAxXG4gICAgV0VJR0hUX0MgPSAxXG4gICAgV0VJR0hUX0ggPSAxXG5cbiAgICBbTDEsIGExLCBiMV0gPSBsYWIxXG4gICAgW0wyLCBhMiwgYjJdID0gbGFiMlxuICAgIGRMID0gTDEgLSBMMlxuICAgIGRhID0gYTEgLSBhMlxuICAgIGRiID0gYjEgLSBiMlxuXG4gICAgeEMxID0gTWF0aC5zcXJ0IGExICogYTEgKyBiMSAqIGIxXG4gICAgeEMyID0gTWF0aC5zcXJ0IGEyICogYTIgKyBiMiAqIGIyXG5cbiAgICB4REwgPSBMMiAtIEwxXG4gICAgeERDID0geEMyIC0geEMxXG4gICAgeERFID0gTWF0aC5zcXJ0IGRMICogZEwgKyBkYSAqIGRhICsgZGIgKiBkYlxuXG4gICAgaWYgTWF0aC5zcXJ0KHhERSkgPiBNYXRoLnNxcnQoTWF0aC5hYnMoeERMKSkgKyBNYXRoLnNxcnQoTWF0aC5hYnMoeERDKSlcbiAgICAgIHhESCA9IE1hdGguc3FydCB4REUgKiB4REUgLSB4REwgKiB4REwgLSB4REMgKiB4RENcbiAgICBlbHNlXG4gICAgICB4REggPSAwXG5cbiAgICB4U0MgPSAxICsgMC4wNDUgKiB4QzFcbiAgICB4U0ggPSAxICsgMC4wMTUgKiB4QzFcblxuICAgIHhETCAvPSBXRUlHSFRfTFxuICAgIHhEQyAvPSBXRUlHSFRfQyAqIHhTQ1xuICAgIHhESCAvPSBXRUlHSFRfSCAqIHhTSFxuXG4gICAgTWF0aC5zcXJ0IHhETCAqIHhETCArIHhEQyAqIHhEQyArIHhESCAqIHhESFxuXG4gIHJnYkRpZmY6IChyZ2IxLCByZ2IyKSAtPlxuICAgIGxhYjEgPSBAcmdiVG9DSUVMYWIuYXBwbHkgQCwgcmdiMVxuICAgIGxhYjIgPSBAcmdiVG9DSUVMYWIuYXBwbHkgQCwgcmdiMlxuICAgIEBkZWx0YUU5NCBsYWIxLCBsYWIyXG5cbiAgaGV4RGlmZjogKGhleDEsIGhleDIpIC0+XG4gICAgIyBjb25zb2xlLmxvZyBcIkNvbXBhcmUgI3toZXgxfSAje2hleDJ9XCJcbiAgICByZ2IxID0gQGhleFRvUmdiIGhleDFcbiAgICByZ2IyID0gQGhleFRvUmdiIGhleDJcbiAgICAjIGNvbnNvbGUubG9nIHJnYjFcbiAgICAjIGNvbnNvbGUubG9nIHJnYjJcbiAgICBAcmdiRGlmZiByZ2IxLCByZ2IyXG5cbiAgREVMVEFFOTRfRElGRl9TVEFUVVM6IERFTFRBRTk0XG5cbiAgZ2V0Q29sb3JEaWZmU3RhdHVzOiAoZCkgLT5cbiAgICBpZiBkIDwgREVMVEFFOTQuTkFcbiAgICAgIHJldHVybiBcIk4vQVwiXG4gICAgIyBOb3QgcGVyY2VwdGlibGUgYnkgaHVtYW4gZXllc1xuICAgIGlmIGQgPD0gREVMVEFFOTQuUEVSRkVDVFxuICAgICAgcmV0dXJuIFwiUGVyZmVjdFwiXG4gICAgIyBQZXJjZXB0aWJsZSB0aHJvdWdoIGNsb3NlIG9ic2VydmF0aW9uXG4gICAgaWYgZCA8PSBERUxUQUU5NC5DTE9TRVxuICAgICAgcmV0dXJuIFwiQ2xvc2VcIlxuICAgICMgUGVyY2VwdGlibGUgYXQgYSBnbGFuY2VcbiAgICBpZiBkIDw9IERFTFRBRTk0LkdPT0RcbiAgICAgIHJldHVybiBcIkdvb2RcIlxuICAgICMgQ29sb3JzIGFyZSBtb3JlIHNpbWlsYXIgdGhhbiBvcHBvc2l0ZVxuICAgIGlmIGQgPCBERUxUQUU5NC5TSU1JTEFSXG4gICAgICByZXR1cm4gXCJTaW1pbGFyXCJcbiAgICByZXR1cm4gXCJXcm9uZ1wiXG5cbiAgU0lHQklUUzogU0lHQklUU1xuICBSU0hJRlQ6IFJTSElGVFxuICBnZXRDb2xvckluZGV4OiAociwgZywgYikgLT5cbiAgICAocjw8KDIqU0lHQklUUykpICsgKGcgPDwgU0lHQklUUykgKyBiXG5cbiAgQ29sb3I6IENvbG9yXG5cbiAgY2FsY3VsYXRlTWluaW11bUFscGhhOiAoZm9yZWdyb3VuZCwgYmFja2dyb3VuZCwgbWluQ29udHJhc3RSYXRpbykgLT5cbiAgICBpZiAoQ29sb3IuYWxwaGEgYmFja2dyb3VuZCkgIT0gMjU1XG4gICAgICAgIHRocm93IG5ldyBFcnJvciBcImJhY2tncm91bmQgY2FuIG5vdCBiZSB0cmFuc2x1Y2VudFwiXG5cbiAgICAjIEZpcnN0IGxldHMgY2hlY2sgdGhhdCBhIGZ1bGx5IG9wYXF1ZSBmb3JlZ3JvdW5kIGhhcyBzdWZmaWNpZW50IGNvbnRyYXN0XG4gICAgdGVzdEZvcmVncm91bmQgPSBAc2V0QWxwaGFDb21wb25lbnQgZm9yZWdyb3VuZCwgMjU1XG4gICAgdGVzdFJhdGlvID0gQGNhbGN1bGF0ZUNvbnRyYXN0IHRlc3RGb3JlZ3JvdW5kLCBiYWNrZ3JvdW5kXG4gICAgaWYgdGVzdFJhdGlvIDwgbWluQ29udHJhc3RSYXRpb1xuICAgICAgICAjIEZ1bGx5IG9wYXF1ZSBmb3JlZ3JvdW5kIGRvZXMgbm90IGhhdmUgc3VmZmljaWVudCBjb250cmFzdCwgcmV0dXJuIGVycm9yXG4gICAgICAgIHJldHVybiAtMVxuXG4gICAgIyBCaW5hcnkgc2VhcmNoIHRvIGZpbmQgYSB2YWx1ZSB3aXRoIHRoZSBtaW5pbXVtIHZhbHVlIHdoaWNoIHByb3ZpZGVzIHN1ZmZpY2llbnQgY29udHJhc3RcbiAgICBudW1JdGVyYXRpb25zID0gMFxuICAgIG1pbkFscGhhID0gMFxuICAgIG1heEFscGhhID0gMjU1XG5cbiAgICB3aGlsZSAobnVtSXRlcmF0aW9ucyA8PSBNSU5fQUxQSEFfU0VBUkNIX01BWF9JVEVSQVRJT05TKSBhbmQgKChtYXhBbHBoYSAtIG1pbkFscGhhKSA+IE1JTl9BTFBIQV9TRUFSQ0hfUFJFQ0lTSU9OKVxuICAgICAgICB0ZXN0QWxwaGEgPSBNYXRoLmZsb29yIChtaW5BbHBoYSArIG1heEFscGhhKSAvIDJcblxuICAgICAgICB0ZXN0Rm9yZWdyb3VuZCA9IEBzZXRBbHBoYUNvbXBvbmVudCBmb3JlZ3JvdW5kLCB0ZXN0QWxwaGFcbiAgICAgICAgdGVzdFJhdGlvID0gQGNhbGN1bGF0ZUNvbnRyYXN0IHRlc3RGb3JlZ3JvdW5kLCBiYWNrZ3JvdW5kXG5cbiAgICAgICAgaWYgdGVzdFJhdGlvIDwgbWluQ29udHJhc3RSYXRpb1xuICAgICAgICAgIG1pbkFscGhhID0gdGVzdEFscGhhXG4gICAgICAgIGVsc2VcbiAgICAgICAgICBtYXhBbHBoYSA9IHRlc3RBbHBoYVxuXG4gICAgICAgIG51bUl0ZXJhdGlvbnMgKz0gMVxuXG4gICAgIyBDb25zZXJ2YXRpdmVseSByZXR1cm4gdGhlIG1heCBvZiB0aGUgcmFuZ2Ugb2YgcG9zc2libGUgYWxwaGFzLCB3aGljaCBpcyBrbm93biB0byBwYXNzLlxuICAgIG1heEFscGhhXG5cbiAgc2V0QWxwaGFDb21wb25lbnQ6IChjb2xvciwgYWxwaGEpIC0+XG4gICAgW2FscGhhLCBjb2xvclsxXSwgY29sb3JbMl0sIGNvbG9yWzNdXVxuXG4gIGNhbGN1bGF0ZUNvbnRyYXN0OiAoZm9yZWdyb3VuZCwgYmFja2dyb3VuZCkgLT5cbiAgICBpZiAoQ29sb3IuYWxwaGEgYmFja2dyb3VuZCkgIT0gMjU1XG4gICAgICB0aHJvdyBuZXcgRXJyb3IgJ2JhY2tncm91bmQgY2FuIG5vdCBiZSB0cmFuc2x1Y2VudCdcblxuICAgIGlmIChDb2xvci5hbHBoYSBmb3JlZ3JvdW5kKSA8IDI1NVxuICAgICAgIyBJZiB0aGUgZm9yZWdyb3VuZCBpcyB0cmFuc2x1Y2VudCwgY29tcG9zaXRlIHRoZSBmb3JlZ3JvdW5kIG92ZXIgdGhlIGJhY2tncm91bmRcbiAgICAgIGZvcmVncm91bmQgPSBAY29tcG9zaXRlQ29sb3JzIGZvcmVncm91bmQsIGJhY2tncm91bmRcblxuICAgIGx1bWluYW5jZTEgPSAoQGNhbGN1bGF0ZUx1bWluYW5jZSBmb3JlZ3JvdW5kKSArIDAuMDVcbiAgICBsdW1pbmFuY2UyID0gKEBjYWxjdWxhdGVMdW1pbmFuY2UgYmFja2dyb3VuZCkgKyAwLjA1XG5cbiAgICAjIE5vdyByZXR1cm4gdGhlIGxpZ2h0ZXIgbHVtaW5hbmNlIGRpdmlkZWQgYnkgdGhlIGRhcmtlciBsdW1pbmFuY2VcbiAgICAoTWF0aC5tYXggbHVtaW5hbmNlMSwgbHVtaW5hbmNlMikgLyAoTWF0aC5taW4gbHVtaW5hbmNlMSwgbHVtaW5hbmNlMilcblxuICBjYWxjdWxhdGVMdW1pbmFuY2U6IChhcmdiKSAtPlxuICAgIHJlZCA9IENvbG9yLnJlZChhcmdiKSAvIDI1NS4wXG4gICAgcmVkID0gaWYgcmVkIDwgMC4wMzkyOCB0aGVuIHJlZCAvIDEyLjkyIGVsc2UgTWF0aC5wb3coKHJlZCArIDAuMDU1KSAvIDEuMDU1LCAyLjQpXG5cbiAgICBncmVlbiA9IENvbG9yLmdyZWVuKGFyZ2IpIC8gMjU1LjBcbiAgICBncmVlbiA9IGlmIGdyZWVuIDwgMC4wMzkyOCB0aGVuIGdyZWVuIC8gMTIuOTIgZWxzZSBNYXRoLnBvdygoZ3JlZW4gKyAwLjA1NSkgLyAxLjA1NSwgMi40KVxuXG4gICAgYmx1ZSA9IENvbG9yLmJsdWUoYXJnYikgLyAyNTUuMDtcbiAgICBibHVlID0gaWYgYmx1ZSA8IDAuMDM5MjggdGhlbiBibHVlIC8gMTIuOTIgZWxzZSBNYXRoLnBvdygoYmx1ZSArIDAuMDU1KSAvIDEuMDU1LCAyLjQpXG5cbiAgICAoMC4yMTI2ICogcmVkKSArICgwLjcxNTIgKiBncmVlbikgKyAoMC4wNzIyICogYmx1ZSlcblxuICBjb21wb3NpdGVDb2xvcnM6IChmZywgYmcpIC0+XG4gICAgYWxwaGExID0gQ29sb3IuYWxwaGEoZmcpIC8gMjU1LjBcbiAgICBhbHBoYTIgPSBDb2xvci5hbHBoYShiZykgLyAyNTUuMFxuXG4gICAgYSA9IChhbHBoYTEgKyBhbHBoYTIpICogKDEuMCAtIGFscGhhMSlcbiAgICByID0gKENvbG9yLnJlZChmZykgKiBhbHBoYTEpICsgKENvbG9yLnJlZChiZykgKiBhbHBoYTIgKiAoMS4wIC0gYWxwaGExKSlcbiAgICBnID0gKENvbG9yLmdyZWVuKGZnKSAqIGFscGhhMSkgKyAoQ29sb3IuZ3JlZW4oYmcpICogYWxwaGEyICogKDEuMCAtIGFscGhhMSkpXG4gICAgYiA9IChDb2xvci5ibHVlKGZnKSAqIGFscGhhMSkgKyAoQ29sb3IuYmx1ZShiZykgKiBhbHBoYTIgKiAoMS4wIC0gYWxwaGExKSlcblxuICAgIENvbG9yLmFyZ2IgYSwgciwgZywgYlxuIiwiIyMjXG4gIEZyb20gVmlicmFudC5qcyBieSBKYXJpIFp3YXJ0c1xuICBQb3J0ZWQgdG8gbm9kZS5qcyBieSBBS0Zpc2hcblxuICBDb2xvciBhbGdvcml0aG0gY2xhc3MgdGhhdCBmaW5kcyB2YXJpYXRpb25zIG9uIGNvbG9ycyBpbiBhbiBpbWFnZS5cblxuICBDcmVkaXRzXG4gIC0tLS0tLS0tXG4gIExva2VzaCBEaGFrYXIgKGh0dHA6Ly93d3cubG9rZXNoZGhha2FyLmNvbSkgLSBDcmVhdGVkIENvbG9yVGhpZWZcbiAgR29vZ2xlIC0gUGFsZXR0ZSBzdXBwb3J0IGxpYnJhcnkgaW4gQW5kcm9pZFxuIyMjXG5Td2F0Y2ggPSByZXF1aXJlKCcuL3N3YXRjaCcpXG51dGlsID0gcmVxdWlyZSgnLi91dGlsJylcbkRlZmF1bHRHZW5lcmF0b3IgPSByZXF1aXJlKCcuL2dlbmVyYXRvcicpLkRlZmF1bHRcbkZpbHRlciA9IHJlcXVpcmUoJy4vZmlsdGVyJylcblxubW9kdWxlLmV4cG9ydHMgPVxuY2xhc3MgVmlicmFudFxuICBARGVmYXVsdE9wdHM6XG4gICAgY29sb3JDb3VudDogNjRcbiAgICBxdWFsaXR5OiA1XG4gICAgZ2VuZXJhdG9yOiBuZXcgRGVmYXVsdEdlbmVyYXRvcigpXG4gICAgSW1hZ2U6IG51bGxcbiAgICBRdWFudGl6ZXI6IHJlcXVpcmUoJy4vcXVhbnRpemVyJykuTU1DUVxuICAgIGZpbHRlcnM6IFtdXG5cbiAgQGZyb206IChzcmMpIC0+XG4gICAgbmV3IEJ1aWxkZXIoc3JjKVxuXG4gIHF1YW50aXplOiByZXF1aXJlKCdxdWFudGl6ZScpXG5cbiAgX3N3YXRjaGVzOiBbXVxuXG4gIGNvbnN0cnVjdG9yOiAoQHNvdXJjZUltYWdlLCBvcHRzID0ge30pIC0+XG4gICAgQG9wdHMgPSB1dGlsLmRlZmF1bHRzKG9wdHMsIEBjb25zdHJ1Y3Rvci5EZWZhdWx0T3B0cylcbiAgICBAZ2VuZXJhdG9yID0gQG9wdHMuZ2VuZXJhdG9yXG5cbiAgZ2V0UGFsZXR0ZTogKGNiKSAtPlxuICAgIGltYWdlID0gbmV3IEBvcHRzLkltYWdlIEBzb3VyY2VJbWFnZSwgKGVyciwgaW1hZ2UpID0+XG4gICAgICBpZiBlcnI/IHRoZW4gcmV0dXJuIGNiKGVycilcbiAgICAgIHRyeVxuICAgICAgICBAX3Byb2Nlc3MgaW1hZ2UsIEBvcHRzXG4gICAgICAgIGNiIG51bGwsIEBzd2F0Y2hlcygpXG4gICAgICBjYXRjaCBlcnJvclxuICAgICAgICByZXR1cm4gY2IoZXJyb3IpXG5cbiAgZ2V0U3dhdGNoZXM6IChjYikgLT5cbiAgICBAZ2V0UGFsZXR0ZSBjYlxuXG4gIF9wcm9jZXNzOiAoaW1hZ2UsIG9wdHMpIC0+XG4gICAgaW1hZ2Uuc2NhbGVEb3duKEBvcHRzKVxuICAgIGltYWdlRGF0YSA9IGltYWdlLmdldEltYWdlRGF0YSgpXG5cbiAgICBxdWFudGl6ZXIgPSBuZXcgQG9wdHMuUXVhbnRpemVyKClcbiAgICBxdWFudGl6ZXIuaW5pdGlhbGl6ZShpbWFnZURhdGEuZGF0YSwgQG9wdHMpXG5cbiAgICBzd2F0Y2hlcyA9IHF1YW50aXplci5nZXRRdWFudGl6ZWRDb2xvcnMoKVxuXG4gICAgQGdlbmVyYXRvci5nZW5lcmF0ZShzd2F0Y2hlcylcbiAgICAjIENsZWFuIHVwXG4gICAgaW1hZ2UucmVtb3ZlQ2FudmFzKClcblxuICBzd2F0Y2hlczogPT5cbiAgICBWaWJyYW50OiAgICAgIEBnZW5lcmF0b3IuZ2V0VmlicmFudFN3YXRjaCgpXG4gICAgTXV0ZWQ6ICAgICAgICBAZ2VuZXJhdG9yLmdldE11dGVkU3dhdGNoKClcbiAgICBEYXJrVmlicmFudDogIEBnZW5lcmF0b3IuZ2V0RGFya1ZpYnJhbnRTd2F0Y2goKVxuICAgIERhcmtNdXRlZDogICAgQGdlbmVyYXRvci5nZXREYXJrTXV0ZWRTd2F0Y2goKVxuICAgIExpZ2h0VmlicmFudDogQGdlbmVyYXRvci5nZXRMaWdodFZpYnJhbnRTd2F0Y2goKVxuICAgIExpZ2h0TXV0ZWQ6ICAgQGdlbmVyYXRvci5nZXRMaWdodE11dGVkU3dhdGNoKClcblxubW9kdWxlLmV4cG9ydHMuQnVpbGRlciA9XG5jbGFzcyBCdWlsZGVyXG4gIGNvbnN0cnVjdG9yOiAoQHNyYywgQG9wdHMgPSB7fSkgLT5cbiAgICBAb3B0cy5maWx0ZXJzID0gdXRpbC5jbG9uZSBWaWJyYW50LkRlZmF1bHRPcHRzLmZpbHRlcnNcblxuICBtYXhDb2xvckNvdW50OiAobikgLT5cbiAgICBAb3B0cy5jb2xvckNvdW50ID0gblxuICAgIEBcblxuICBtYXhEaW1lbnNpb246IChkKSAtPlxuICAgIEBvcHRzLm1heERpbWVuc2lvbiA9IGRcbiAgICBAXG5cbiAgYWRkRmlsdGVyOiAoZikgLT5cbiAgICBpZiB0eXBlb2YgZiA9PSAnZnVuY3Rpb24nXG4gICAgICBAb3B0cy5maWx0ZXJzLnB1c2ggZlxuICAgIEBcblxuICByZW1vdmVGaWx0ZXI6IChmKSAtPlxuICAgIGlmIChpID0gQG9wdHMuZmlsdGVycy5pbmRleE9mKGYpKSA+IDBcbiAgICAgIEBvcHRzLmZpbHRlcnMuc3BsaWNlKGkpXG4gICAgQFxuXG4gIGNsZWFyRmlsdGVyczogLT5cbiAgICBAb3B0cy5maWx0ZXJzID0gW11cbiAgICBAXG5cbiAgcXVhbGl0eTogKHEpIC0+XG4gICAgQG9wdHMucXVhbGl0eSA9IHFcbiAgICBAXG5cbiAgdXNlSW1hZ2U6IChpbWFnZSkgLT5cbiAgICBAb3B0cy5JbWFnZSA9IGltYWdlXG4gICAgQFxuXG4gIHVzZUdlbmVyYXRvcjogKGdlbmVyYXRvcikgLT5cbiAgICBAb3B0cy5nZW5lcmF0b3IgPSBnZW5lcmF0b3JcbiAgICBAXG5cbiAgdXNlUXVhbnRpemVyOiAocXVhbnRpemVyKSAtPlxuICAgIEBvcHRzLlF1YW50aXplciA9IHF1YW50aXplclxuICAgIEBcblxuICBidWlsZDogLT5cbiAgICBpZiBub3QgQHY/XG4gICAgICBAdiA9IG5ldyBWaWJyYW50KEBzcmMsIEBvcHRzKVxuICAgIEB2XG5cbiAgZ2V0U3dhdGNoZXM6IChjYikgLT5cbiAgICBAYnVpbGQoKS5nZXRQYWxldHRlIGNiXG5cbiAgZ2V0UGFsZXR0ZTogKGNiKSAtPlxuICAgIEBidWlsZCgpLmdldFBhbGV0dGUgY2JcblxuICBmcm9tOiAoc3JjKSAtPlxuICAgIG5ldyBWaWJyYW50KHNyYywgQG9wdHMpXG5cbm1vZHVsZS5leHBvcnRzLlV0aWwgPSB1dGlsXG5tb2R1bGUuZXhwb3J0cy5Td2F0Y2ggPSBTd2F0Y2hcbm1vZHVsZS5leHBvcnRzLlF1YW50aXplciA9IHJlcXVpcmUoJy4vcXVhbnRpemVyLycpXG5tb2R1bGUuZXhwb3J0cy5HZW5lcmF0b3IgPSByZXF1aXJlKCcuL2dlbmVyYXRvci8nKVxubW9kdWxlLmV4cG9ydHMuRmlsdGVyID0gcmVxdWlyZSgnLi9maWx0ZXIvJylcbiIsIi8qXHJcbiAqIHF1YW50aXplLmpzIENvcHlyaWdodCAyMDA4IE5pY2sgUmFiaW5vd2l0elxyXG4gKiBQb3J0ZWQgdG8gbm9kZS5qcyBieSBPbGl2aWVyIExlc25pY2tpXHJcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBNSVQgbGljZW5zZTogaHR0cDovL3d3dy5vcGVuc291cmNlLm9yZy9saWNlbnNlcy9taXQtbGljZW5zZS5waHBcclxuICovXHJcblxyXG4vLyBmaWxsIG91dCBhIGNvdXBsZSBwcm90b3ZpcyBkZXBlbmRlbmNpZXNcclxuLypcclxuICogQmxvY2sgYmVsb3cgY29waWVkIGZyb20gUHJvdG92aXM6IGh0dHA6Ly9tYm9zdG9jay5naXRodWIuY29tL3Byb3RvdmlzL1xyXG4gKiBDb3B5cmlnaHQgMjAxMCBTdGFuZm9yZCBWaXN1YWxpemF0aW9uIEdyb3VwXHJcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBCU0QgTGljZW5zZTogaHR0cDovL3d3dy5vcGVuc291cmNlLm9yZy9saWNlbnNlcy9ic2QtbGljZW5zZS5waHBcclxuICovXHJcbmlmICghcHYpIHtcclxuICAgIHZhciBwdiA9IHtcclxuICAgICAgICBtYXA6IGZ1bmN0aW9uKGFycmF5LCBmKSB7XHJcbiAgICAgICAgICAgIHZhciBvID0ge307XHJcbiAgICAgICAgICAgIHJldHVybiBmID8gYXJyYXkubWFwKGZ1bmN0aW9uKGQsIGkpIHtcclxuICAgICAgICAgICAgICAgIG8uaW5kZXggPSBpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGYuY2FsbChvLCBkKTtcclxuICAgICAgICAgICAgfSkgOiBhcnJheS5zbGljZSgpO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgbmF0dXJhbE9yZGVyOiBmdW5jdGlvbihhLCBiKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBhIC0gYjtcclxuICAgICAgICB9LFxyXG4gICAgICAgIHN1bTogZnVuY3Rpb24oYXJyYXksIGYpIHtcclxuICAgICAgICAgICAgdmFyIG8gPSB7fTtcclxuICAgICAgICAgICAgcmV0dXJuIGFycmF5LnJlZHVjZShmID8gZnVuY3Rpb24ocCwgZCwgaSkge1xyXG4gICAgICAgICAgICAgICAgby5pbmRleCA9IGk7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gcCArIGYuY2FsbChvLCBkKTtcclxuICAgICAgICAgICAgfSA6IGZ1bmN0aW9uKHAsIGQpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiBwICsgZDtcclxuICAgICAgICAgICAgfSwgMCk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBtYXg6IGZ1bmN0aW9uKGFycmF5LCBmKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBNYXRoLm1heC5hcHBseShudWxsLCBmID8gcHYubWFwKGFycmF5LCBmKSA6IGFycmF5KTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBCYXNpYyBKYXZhc2NyaXB0IHBvcnQgb2YgdGhlIE1NQ1EgKG1vZGlmaWVkIG1lZGlhbiBjdXQgcXVhbnRpemF0aW9uKVxyXG4gKiBhbGdvcml0aG0gZnJvbSB0aGUgTGVwdG9uaWNhIGxpYnJhcnkgKGh0dHA6Ly93d3cubGVwdG9uaWNhLmNvbS8pLlxyXG4gKiBSZXR1cm5zIGEgY29sb3IgbWFwIHlvdSBjYW4gdXNlIHRvIG1hcCBvcmlnaW5hbCBwaXhlbHMgdG8gdGhlIHJlZHVjZWRcclxuICogcGFsZXR0ZS4gU3RpbGwgYSB3b3JrIGluIHByb2dyZXNzLlxyXG4gKlxyXG4gKiBAYXV0aG9yIE5pY2sgUmFiaW5vd2l0elxyXG4gKiBAZXhhbXBsZVxyXG5cclxuLy8gYXJyYXkgb2YgcGl4ZWxzIGFzIFtSLEcsQl0gYXJyYXlzXHJcbnZhciBteVBpeGVscyA9IFtbMTkwLDE5NywxOTBdLCBbMjAyLDIwNCwyMDBdLCBbMjA3LDIxNCwyMTBdLCBbMjExLDIxNCwyMTFdLCBbMjA1LDIwNywyMDddXHJcbiAgICAgICAgICAgICAgICAvLyBldGNcclxuICAgICAgICAgICAgICAgIF07XHJcbnZhciBtYXhDb2xvcnMgPSA0O1xyXG5cclxudmFyIGNtYXAgPSBNTUNRLnF1YW50aXplKG15UGl4ZWxzLCBtYXhDb2xvcnMpO1xyXG52YXIgbmV3UGFsZXR0ZSA9IGNtYXAucGFsZXR0ZSgpO1xyXG52YXIgbmV3UGl4ZWxzID0gbXlQaXhlbHMubWFwKGZ1bmN0aW9uKHApIHtcclxuICAgIHJldHVybiBjbWFwLm1hcChwKTtcclxufSk7XHJcblxyXG4gKi9cclxudmFyIE1NQ1EgPSAoZnVuY3Rpb24oKSB7XHJcbiAgICAvLyBwcml2YXRlIGNvbnN0YW50c1xyXG4gICAgdmFyIHNpZ2JpdHMgPSA1LFxyXG4gICAgICAgIHJzaGlmdCA9IDggLSBzaWdiaXRzLFxyXG4gICAgICAgIG1heEl0ZXJhdGlvbnMgPSAxMDAwLFxyXG4gICAgICAgIGZyYWN0QnlQb3B1bGF0aW9ucyA9IDAuNzU7XHJcblxyXG4gICAgLy8gZ2V0IHJlZHVjZWQtc3BhY2UgY29sb3IgaW5kZXggZm9yIGEgcGl4ZWxcclxuXHJcbiAgICBmdW5jdGlvbiBnZXRDb2xvckluZGV4KHIsIGcsIGIpIHtcclxuICAgICAgICByZXR1cm4gKHIgPDwgKDIgKiBzaWdiaXRzKSkgKyAoZyA8PCBzaWdiaXRzKSArIGI7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gU2ltcGxlIHByaW9yaXR5IHF1ZXVlXHJcblxyXG4gICAgZnVuY3Rpb24gUFF1ZXVlKGNvbXBhcmF0b3IpIHtcclxuICAgICAgICB2YXIgY29udGVudHMgPSBbXSxcclxuICAgICAgICAgICAgc29ydGVkID0gZmFsc2U7XHJcblxyXG4gICAgICAgIGZ1bmN0aW9uIHNvcnQoKSB7XHJcbiAgICAgICAgICAgIGNvbnRlbnRzLnNvcnQoY29tcGFyYXRvcik7XHJcbiAgICAgICAgICAgIHNvcnRlZCA9IHRydWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICBwdXNoOiBmdW5jdGlvbihvKSB7XHJcbiAgICAgICAgICAgICAgICBjb250ZW50cy5wdXNoKG8pO1xyXG4gICAgICAgICAgICAgICAgc29ydGVkID0gZmFsc2U7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHBlZWs6IGZ1bmN0aW9uKGluZGV4KSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIXNvcnRlZCkgc29ydCgpO1xyXG4gICAgICAgICAgICAgICAgaWYgKGluZGV4ID09PSB1bmRlZmluZWQpIGluZGV4ID0gY29udGVudHMubGVuZ3RoIC0gMTtcclxuICAgICAgICAgICAgICAgIHJldHVybiBjb250ZW50c1tpbmRleF07XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHBvcDogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoIXNvcnRlZCkgc29ydCgpO1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGNvbnRlbnRzLnBvcCgpO1xyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgICBzaXplOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiBjb250ZW50cy5sZW5ndGg7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIG1hcDogZnVuY3Rpb24oZikge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIGNvbnRlbnRzLm1hcChmKTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgZGVidWc6IGZ1bmN0aW9uKCkge1xyXG4gICAgICAgICAgICAgICAgaWYgKCFzb3J0ZWQpIHNvcnQoKTtcclxuICAgICAgICAgICAgICAgIHJldHVybiBjb250ZW50cztcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gM2QgY29sb3Igc3BhY2UgYm94XHJcblxyXG4gICAgZnVuY3Rpb24gVkJveChyMSwgcjIsIGcxLCBnMiwgYjEsIGIyLCBoaXN0bykge1xyXG4gICAgICAgIHZhciB2Ym94ID0gdGhpcztcclxuICAgICAgICB2Ym94LnIxID0gcjE7XHJcbiAgICAgICAgdmJveC5yMiA9IHIyO1xyXG4gICAgICAgIHZib3guZzEgPSBnMTtcclxuICAgICAgICB2Ym94LmcyID0gZzI7XHJcbiAgICAgICAgdmJveC5iMSA9IGIxO1xyXG4gICAgICAgIHZib3guYjIgPSBiMjtcclxuICAgICAgICB2Ym94Lmhpc3RvID0gaGlzdG87XHJcbiAgICB9XHJcbiAgICBWQm94LnByb3RvdHlwZSA9IHtcclxuICAgICAgICB2b2x1bWU6IGZ1bmN0aW9uKGZvcmNlKSB7XHJcbiAgICAgICAgICAgIHZhciB2Ym94ID0gdGhpcztcclxuICAgICAgICAgICAgaWYgKCF2Ym94Ll92b2x1bWUgfHwgZm9yY2UpIHtcclxuICAgICAgICAgICAgICAgIHZib3guX3ZvbHVtZSA9ICgodmJveC5yMiAtIHZib3gucjEgKyAxKSAqICh2Ym94LmcyIC0gdmJveC5nMSArIDEpICogKHZib3guYjIgLSB2Ym94LmIxICsgMSkpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJldHVybiB2Ym94Ll92b2x1bWU7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBjb3VudDogZnVuY3Rpb24oZm9yY2UpIHtcclxuICAgICAgICAgICAgdmFyIHZib3ggPSB0aGlzLFxyXG4gICAgICAgICAgICAgICAgaGlzdG8gPSB2Ym94Lmhpc3RvO1xyXG4gICAgICAgICAgICBpZiAoIXZib3guX2NvdW50X3NldCB8fCBmb3JjZSkge1xyXG4gICAgICAgICAgICAgICAgdmFyIG5waXggPSAwLFxyXG4gICAgICAgICAgICAgICAgICAgIGksIGosIGs7XHJcbiAgICAgICAgICAgICAgICBmb3IgKGkgPSB2Ym94LnIxOyBpIDw9IHZib3gucjI7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgICAgIGZvciAoaiA9IHZib3guZzE7IGogPD0gdmJveC5nMjsgaisrKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAoayA9IHZib3guYjE7IGsgPD0gdmJveC5iMjsgaysrKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmRleCA9IGdldENvbG9ySW5kZXgoaSwgaiwgayk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBucGl4ICs9IGhpc3RvW2luZGV4XTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHZib3guX2NvdW50ID0gbnBpeDtcclxuICAgICAgICAgICAgICAgIHZib3guX2NvdW50X3NldCA9IHRydWU7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgcmV0dXJuIHZib3guX2NvdW50O1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgY29weTogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHZhciB2Ym94ID0gdGhpcztcclxuICAgICAgICAgICAgcmV0dXJuIG5ldyBWQm94KHZib3gucjEsIHZib3gucjIsIHZib3guZzEsIHZib3guZzIsIHZib3guYjEsIHZib3guYjIsIHZib3guaGlzdG8pO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgYXZnOiBmdW5jdGlvbihmb3JjZSkge1xyXG4gICAgICAgICAgICB2YXIgdmJveCA9IHRoaXMsXHJcbiAgICAgICAgICAgICAgICBoaXN0byA9IHZib3guaGlzdG87XHJcbiAgICAgICAgICAgIGlmICghdmJveC5fYXZnIHx8IGZvcmNlKSB7XHJcbiAgICAgICAgICAgICAgICB2YXIgbnRvdCA9IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgbXVsdCA9IDEgPDwgKDggLSBzaWdiaXRzKSxcclxuICAgICAgICAgICAgICAgICAgICAvLyBtdWx0ID0gKDggLSBzaWdiaXRzKSxcclxuICAgICAgICAgICAgICAgICAgICByc3VtID0gMCxcclxuICAgICAgICAgICAgICAgICAgICBnc3VtID0gMCxcclxuICAgICAgICAgICAgICAgICAgICBic3VtID0gMCxcclxuICAgICAgICAgICAgICAgICAgICBodmFsLFxyXG4gICAgICAgICAgICAgICAgICAgIGksIGosIGssIGhpc3RvaW5kZXg7XHJcbiAgICAgICAgICAgICAgICBmb3IgKGkgPSB2Ym94LnIxOyBpIDw9IHZib3gucjI7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgICAgIGZvciAoaiA9IHZib3guZzE7IGogPD0gdmJveC5nMjsgaisrKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGZvciAoayA9IHZib3guYjE7IGsgPD0gdmJveC5iMjsgaysrKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBoaXN0b2luZGV4ID0gZ2V0Q29sb3JJbmRleChpLCBqLCBrKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGh2YWwgPSBoaXN0b1toaXN0b2luZGV4XTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG50b3QgKz0gaHZhbDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJzdW0gKz0gKGh2YWwgKiAoaSArIDAuNSkgKiBtdWx0KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGdzdW0gKz0gKGh2YWwgKiAoaiArIDAuNSkgKiBtdWx0KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJzdW0gKz0gKGh2YWwgKiAoayArIDAuNSkgKiBtdWx0KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIGlmIChudG90KSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdmJveC5fYXZnID0gW35+KHJzdW0gLyBudG90KSwgfn4gKGdzdW0gLyBudG90KSwgfn4gKGJzdW0gLyBudG90KV07XHJcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vY29uc29sZS5sb2coJ2VtcHR5IGJveCcpO1xyXG4gICAgICAgICAgICAgICAgICAgIHZib3guX2F2ZyA9IFt+fihtdWx0ICogKHZib3gucjEgKyB2Ym94LnIyICsgMSkgLyAyKSwgfn4gKG11bHQgKiAodmJveC5nMSArIHZib3guZzIgKyAxKSAvIDIpLCB+fiAobXVsdCAqICh2Ym94LmIxICsgdmJveC5iMiArIDEpIC8gMildO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJldHVybiB2Ym94Ll9hdmc7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBjb250YWluczogZnVuY3Rpb24ocGl4ZWwpIHtcclxuICAgICAgICAgICAgdmFyIHZib3ggPSB0aGlzLFxyXG4gICAgICAgICAgICAgICAgcnZhbCA9IHBpeGVsWzBdID4+IHJzaGlmdDtcclxuICAgICAgICAgICAgZ3ZhbCA9IHBpeGVsWzFdID4+IHJzaGlmdDtcclxuICAgICAgICAgICAgYnZhbCA9IHBpeGVsWzJdID4+IHJzaGlmdDtcclxuICAgICAgICAgICAgcmV0dXJuIChydmFsID49IHZib3gucjEgJiYgcnZhbCA8PSB2Ym94LnIyICYmXHJcbiAgICAgICAgICAgICAgICBndmFsID49IHZib3guZzEgJiYgZ3ZhbCA8PSB2Ym94LmcyICYmXHJcbiAgICAgICAgICAgICAgICBidmFsID49IHZib3guYjEgJiYgYnZhbCA8PSB2Ym94LmIyKTtcclxuICAgICAgICB9XHJcbiAgICB9O1xyXG5cclxuICAgIC8vIENvbG9yIG1hcFxyXG5cclxuICAgIGZ1bmN0aW9uIENNYXAoKSB7XHJcbiAgICAgICAgdGhpcy52Ym94ZXMgPSBuZXcgUFF1ZXVlKGZ1bmN0aW9uKGEsIGIpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHB2Lm5hdHVyYWxPcmRlcihcclxuICAgICAgICAgICAgICAgIGEudmJveC5jb3VudCgpICogYS52Ym94LnZvbHVtZSgpLFxyXG4gICAgICAgICAgICAgICAgYi52Ym94LmNvdW50KCkgKiBiLnZib3gudm9sdW1lKClcclxuICAgICAgICAgICAgKVxyXG4gICAgICAgIH0pOztcclxuICAgIH1cclxuICAgIENNYXAucHJvdG90eXBlID0ge1xyXG4gICAgICAgIHB1c2g6IGZ1bmN0aW9uKHZib3gpIHtcclxuICAgICAgICAgICAgdGhpcy52Ym94ZXMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICB2Ym94OiB2Ym94LFxyXG4gICAgICAgICAgICAgICAgY29sb3I6IHZib3guYXZnKClcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBwYWxldHRlOiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMudmJveGVzLm1hcChmdW5jdGlvbih2Yikge1xyXG4gICAgICAgICAgICAgICAgcmV0dXJuIHZiLmNvbG9yXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgc2l6ZTogZnVuY3Rpb24oKSB7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnZib3hlcy5zaXplKCk7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBtYXA6IGZ1bmN0aW9uKGNvbG9yKSB7XHJcbiAgICAgICAgICAgIHZhciB2Ym94ZXMgPSB0aGlzLnZib3hlcztcclxuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB2Ym94ZXMuc2l6ZSgpOyBpKyspIHtcclxuICAgICAgICAgICAgICAgIGlmICh2Ym94ZXMucGVlayhpKS52Ym94LmNvbnRhaW5zKGNvbG9yKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB2Ym94ZXMucGVlayhpKS5jb2xvcjtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5uZWFyZXN0KGNvbG9yKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIG5lYXJlc3Q6IGZ1bmN0aW9uKGNvbG9yKSB7XHJcbiAgICAgICAgICAgIHZhciB2Ym94ZXMgPSB0aGlzLnZib3hlcyxcclxuICAgICAgICAgICAgICAgIGQxLCBkMiwgcENvbG9yO1xyXG4gICAgICAgICAgICBmb3IgKHZhciBpID0gMDsgaSA8IHZib3hlcy5zaXplKCk7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgZDIgPSBNYXRoLnNxcnQoXHJcbiAgICAgICAgICAgICAgICAgICAgTWF0aC5wb3coY29sb3JbMF0gLSB2Ym94ZXMucGVlayhpKS5jb2xvclswXSwgMikgK1xyXG4gICAgICAgICAgICAgICAgICAgIE1hdGgucG93KGNvbG9yWzFdIC0gdmJveGVzLnBlZWsoaSkuY29sb3JbMV0sIDIpICtcclxuICAgICAgICAgICAgICAgICAgICBNYXRoLnBvdyhjb2xvclsyXSAtIHZib3hlcy5wZWVrKGkpLmNvbG9yWzJdLCAyKVxyXG4gICAgICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgICAgIGlmIChkMiA8IGQxIHx8IGQxID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICAgICAgICAgICAgICBkMSA9IGQyO1xyXG4gICAgICAgICAgICAgICAgICAgIHBDb2xvciA9IHZib3hlcy5wZWVrKGkpLmNvbG9yO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHJldHVybiBwQ29sb3I7XHJcbiAgICAgICAgfSxcclxuICAgICAgICBmb3JjZWJ3OiBmdW5jdGlvbigpIHtcclxuICAgICAgICAgICAgLy8gWFhYOiB3b24ndCAgd29yayB5ZXRcclxuICAgICAgICAgICAgdmFyIHZib3hlcyA9IHRoaXMudmJveGVzO1xyXG4gICAgICAgICAgICB2Ym94ZXMuc29ydChmdW5jdGlvbihhLCBiKSB7XHJcbiAgICAgICAgICAgICAgICByZXR1cm4gcHYubmF0dXJhbE9yZGVyKHB2LnN1bShhLmNvbG9yKSwgcHYuc3VtKGIuY29sb3IpKVxyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIC8vIGZvcmNlIGRhcmtlc3QgY29sb3IgdG8gYmxhY2sgaWYgZXZlcnl0aGluZyA8IDVcclxuICAgICAgICAgICAgdmFyIGxvd2VzdCA9IHZib3hlc1swXS5jb2xvcjtcclxuICAgICAgICAgICAgaWYgKGxvd2VzdFswXSA8IDUgJiYgbG93ZXN0WzFdIDwgNSAmJiBsb3dlc3RbMl0gPCA1KVxyXG4gICAgICAgICAgICAgICAgdmJveGVzWzBdLmNvbG9yID0gWzAsIDAsIDBdO1xyXG5cclxuICAgICAgICAgICAgLy8gZm9yY2UgbGlnaHRlc3QgY29sb3IgdG8gd2hpdGUgaWYgZXZlcnl0aGluZyA+IDI1MVxyXG4gICAgICAgICAgICB2YXIgaWR4ID0gdmJveGVzLmxlbmd0aCAtIDEsXHJcbiAgICAgICAgICAgICAgICBoaWdoZXN0ID0gdmJveGVzW2lkeF0uY29sb3I7XHJcbiAgICAgICAgICAgIGlmIChoaWdoZXN0WzBdID4gMjUxICYmIGhpZ2hlc3RbMV0gPiAyNTEgJiYgaGlnaGVzdFsyXSA+IDI1MSlcclxuICAgICAgICAgICAgICAgIHZib3hlc1tpZHhdLmNvbG9yID0gWzI1NSwgMjU1LCAyNTVdO1xyXG4gICAgICAgIH1cclxuICAgIH07XHJcblxyXG5cclxuICAgIGZ1bmN0aW9uIGdldEFsbChwaXhlbHMsIHNob3VsZElnbm9yZSkge1xyXG4gICAgICAgIHZhciBoaXN0b3NpemUgPSAxIDw8ICgzICogc2lnYml0cyksXHJcbiAgICAgICAgICAgIGhpc3RvID0gbmV3IFVpbnQzMkFycmF5KGhpc3Rvc2l6ZSksXHJcbiAgICAgICAgICAgIGluZGV4LCBydmFsLCBndmFsLCBidmFsO1xyXG4gICAgICAgIHZhciBybWluID0gMTAwMDAwMCxcclxuICAgICAgICAgICAgcm1heCA9IDAsXHJcbiAgICAgICAgICAgIGdtaW4gPSAxMDAwMDAwLFxyXG4gICAgICAgICAgICBnbWF4ID0gMCxcclxuICAgICAgICAgICAgYm1pbiA9IDEwMDAwMDAsXHJcbiAgICAgICAgICAgIGJtYXggPSAwO1xyXG5cclxuICAgICAgICB2YXIgcGl4ZWxDb3VudCA9IHBpeGVscy5sZW5ndGggLyA0LFxyXG4gICAgICAgICAgICBpID0gMDtcclxuXHJcbiAgICAgICAgLy8gWWVzLCBpdCBtYXR0ZXJzXHJcbiAgICAgICAgaWYgKHR5cGVvZiBzaG91bGRJZ25vcmUgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgICAgIHdoaWxlIChpIDwgcGl4ZWxDb3VudCkge1xyXG4gICAgICAgICAgICAgIG9mZnNldCA9IGkgKiA0O1xyXG4gICAgICAgICAgICAgIGkrKztcclxuICAgICAgICAgICAgICByID0gcGl4ZWxzW29mZnNldCArIDBdO1xyXG4gICAgICAgICAgICAgIGcgPSBwaXhlbHNbb2Zmc2V0ICsgMV07XHJcbiAgICAgICAgICAgICAgYiA9IHBpeGVsc1tvZmZzZXQgKyAyXTtcclxuICAgICAgICAgICAgICBhID0gcGl4ZWxzW29mZnNldCArIDNdO1xyXG4gICAgICAgICAgICAgIGlmIChzaG91bGRJZ25vcmUociwgZywgYiwgYSkpIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgIHJ2YWwgPSByID4+IHJzaGlmdDtcclxuICAgICAgICAgICAgICBndmFsID0gZyA+PiByc2hpZnQ7XHJcbiAgICAgICAgICAgICAgYnZhbCA9IGIgPj4gcnNoaWZ0O1xyXG4gICAgICAgICAgICAgIGluZGV4ID0gZ2V0Q29sb3JJbmRleChydmFsLCBndmFsLCBidmFsKTtcclxuICAgICAgICAgICAgICBoaXN0b1tpbmRleF0rKztcclxuICAgICAgICAgICAgICBpZiAocnZhbCA8IHJtaW4pIHJtaW4gPSBydmFsO1xyXG4gICAgICAgICAgICAgIGVsc2UgaWYgKHJ2YWwgPiBybWF4KSBybWF4ID0gcnZhbDtcclxuICAgICAgICAgICAgICBpZiAoZ3ZhbCA8IGdtaW4pIGdtaW4gPSBndmFsO1xyXG4gICAgICAgICAgICAgIGVsc2UgaWYgKGd2YWwgPiBnbWF4KSBnbWF4ID0gZ3ZhbDtcclxuICAgICAgICAgICAgICBpZiAoYnZhbCA8IGJtaW4pIGJtaW4gPSBidmFsO1xyXG4gICAgICAgICAgICAgIGVsc2UgaWYgKGJ2YWwgPiBibWF4KSBibWF4ID0gYnZhbDtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgd2hpbGUgKGkgPCBwaXhlbENvdW50KSB7XHJcbiAgICAgICAgICAgICAgb2Zmc2V0ID0gaSAqIDQ7XHJcbiAgICAgICAgICAgICAgaSsrO1xyXG4gICAgICAgICAgICAgIHIgPSBwaXhlbHNbb2Zmc2V0ICsgMF07XHJcbiAgICAgICAgICAgICAgZyA9IHBpeGVsc1tvZmZzZXQgKyAxXTtcclxuICAgICAgICAgICAgICBiID0gcGl4ZWxzW29mZnNldCArIDJdO1xyXG4gICAgICAgICAgICAgIGEgPSBwaXhlbHNbb2Zmc2V0ICsgM107XHJcbiAgICAgICAgICAgICAgcnZhbCA9IHIgPj4gcnNoaWZ0O1xyXG4gICAgICAgICAgICAgIGd2YWwgPSBnID4+IHJzaGlmdDtcclxuICAgICAgICAgICAgICBidmFsID0gYiA+PiByc2hpZnQ7XHJcbiAgICAgICAgICAgICAgaW5kZXggPSBnZXRDb2xvckluZGV4KHJ2YWwsIGd2YWwsIGJ2YWwpO1xyXG4gICAgICAgICAgICAgIGhpc3RvW2luZGV4XSsrO1xyXG4gICAgICAgICAgICAgIGlmIChydmFsIDwgcm1pbikgcm1pbiA9IHJ2YWw7XHJcbiAgICAgICAgICAgICAgZWxzZSBpZiAocnZhbCA+IHJtYXgpIHJtYXggPSBydmFsO1xyXG4gICAgICAgICAgICAgIGlmIChndmFsIDwgZ21pbikgZ21pbiA9IGd2YWw7XHJcbiAgICAgICAgICAgICAgZWxzZSBpZiAoZ3ZhbCA+IGdtYXgpIGdtYXggPSBndmFsO1xyXG4gICAgICAgICAgICAgIGlmIChidmFsIDwgYm1pbikgYm1pbiA9IGJ2YWw7XHJcbiAgICAgICAgICAgICAgZWxzZSBpZiAoYnZhbCA+IGJtYXgpIGJtYXggPSBidmFsO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIGhpc3RvOiBoaXN0byxcclxuICAgICAgICAgIHZib3g6IG5ldyBWQm94KHJtaW4sIHJtYXgsIGdtaW4sIGdtYXgsIGJtaW4sIGJtYXgsIGhpc3RvKVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgLy8gaGlzdG8gKDEtZCBhcnJheSwgZ2l2aW5nIHRoZSBudW1iZXIgb2YgcGl4ZWxzIGluXHJcbiAgICAvLyBlYWNoIHF1YW50aXplZCByZWdpb24gb2YgY29sb3Igc3BhY2UpLCBvciBudWxsIG9uIGVycm9yXHJcblxyXG4gICAgZnVuY3Rpb24gZ2V0SGlzdG8ocGl4ZWxzLCBzaG91bGRJZ25vcmUpIHtcclxuICAgICAgICB2YXIgaGlzdG9zaXplID0gMSA8PCAoMyAqIHNpZ2JpdHMpLFxyXG4gICAgICAgICAgICBoaXN0byA9IG5ldyBVaW50MzJBcnJheShoaXN0b3NpemUpLFxyXG4gICAgICAgICAgICBpbmRleCwgcnZhbCwgZ3ZhbCwgYnZhbDtcclxuXHJcbiAgICAgICAgdmFyIHBpeGVsQ291bnQgPSBwaXhlbHMubGVuZ3RoIC8gNCxcclxuICAgICAgICAgICAgaSA9IDA7XHJcblxyXG4gICAgICAgIC8vIFllcywgaXQgbWF0dGVyc1xyXG4gICAgICAgIGlmICh0eXBlb2Ygc2hvdWxkSWdub3JlID09PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgICAgICB3aGlsZSAoaSA8IHBpeGVsQ291bnQpIHtcclxuICAgICAgICAgICAgICBvZmZzZXQgPSBpICogNDtcclxuICAgICAgICAgICAgICBpKys7XHJcbiAgICAgICAgICAgICAgciA9IHBpeGVsc1tvZmZzZXQgKyAwXTtcclxuICAgICAgICAgICAgICBnID0gcGl4ZWxzW29mZnNldCArIDFdO1xyXG4gICAgICAgICAgICAgIGIgPSBwaXhlbHNbb2Zmc2V0ICsgMl07XHJcbiAgICAgICAgICAgICAgYSA9IHBpeGVsc1tvZmZzZXQgKyAzXTtcclxuICAgICAgICAgICAgICBpZiAoc2hvdWxkSWdub3JlKHIsIGcsIGIsIGEpKSBjb250aW51ZTtcclxuICAgICAgICAgICAgICBydmFsID0gciA+PiByc2hpZnQ7XHJcbiAgICAgICAgICAgICAgZ3ZhbCA9IGcgPj4gcnNoaWZ0O1xyXG4gICAgICAgICAgICAgIGJ2YWwgPSBiID4+IHJzaGlmdDtcclxuICAgICAgICAgICAgICBpbmRleCA9IGdldENvbG9ySW5kZXgocnZhbCwgZ3ZhbCwgYnZhbCk7XHJcbiAgICAgICAgICAgICAgaGlzdG9baW5kZXhdKys7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIHdoaWxlIChpIDwgcGl4ZWxDb3VudCkge1xyXG4gICAgICAgICAgICAgIG9mZnNldCA9IGkgKiA0O1xyXG4gICAgICAgICAgICAgIGkrKztcclxuICAgICAgICAgICAgICByID0gcGl4ZWxzW29mZnNldCArIDBdO1xyXG4gICAgICAgICAgICAgIGcgPSBwaXhlbHNbb2Zmc2V0ICsgMV07XHJcbiAgICAgICAgICAgICAgYiA9IHBpeGVsc1tvZmZzZXQgKyAyXTtcclxuICAgICAgICAgICAgICBhID0gcGl4ZWxzW29mZnNldCArIDNdO1xyXG4gICAgICAgICAgICAgIHJ2YWwgPSByID4+IHJzaGlmdDtcclxuICAgICAgICAgICAgICBndmFsID0gZyA+PiByc2hpZnQ7XHJcbiAgICAgICAgICAgICAgYnZhbCA9IGIgPj4gcnNoaWZ0O1xyXG4gICAgICAgICAgICAgIGluZGV4ID0gZ2V0Q29sb3JJbmRleChydmFsLCBndmFsLCBidmFsKTtcclxuICAgICAgICAgICAgICBoaXN0b1tpbmRleF0rKztcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHJldHVybiBoaXN0bztcclxuICAgIH1cclxuXHJcbiAgICBmdW5jdGlvbiB2Ym94RnJvbVBpeGVscyhwaXhlbHMsIGhpc3RvLCBzaG91bGRJZ25vcmUpIHtcclxuICAgICAgICB2YXIgcm1pbiA9IDEwMDAwMDAsXHJcbiAgICAgICAgICAgIHJtYXggPSAwLFxyXG4gICAgICAgICAgICBnbWluID0gMTAwMDAwMCxcclxuICAgICAgICAgICAgZ21heCA9IDAsXHJcbiAgICAgICAgICAgIGJtaW4gPSAxMDAwMDAwLFxyXG4gICAgICAgICAgICBibWF4ID0gMCxcclxuICAgICAgICAgICAgcnZhbCwgZ3ZhbCwgYnZhbDtcclxuICAgICAgICAvLyBmaW5kIG1pbi9tYXhcclxuICAgICAgICB2YXIgcGl4ZWxDb3VudCA9IHBpeGVscy5sZW5ndGggLyA0LFxyXG4gICAgICAgICAgICBpID0gMDtcclxuXHJcbiAgICAgICAgLy8gWWVzLCBpdCBtYXR0ZXJzXHJcbiAgICAgICAgaWYgKHR5cGVvZiBzaG91bGRJZ25vcmUgPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgICAgIHdoaWxlIChpIDwgcGl4ZWxDb3VudCkge1xyXG4gICAgICAgICAgICAgIG9mZnNldCA9IGkgKiA0O1xyXG4gICAgICAgICAgICAgIGkrKztcclxuICAgICAgICAgICAgICByID0gcGl4ZWxzW29mZnNldCArIDBdO1xyXG4gICAgICAgICAgICAgIGcgPSBwaXhlbHNbb2Zmc2V0ICsgMV07XHJcbiAgICAgICAgICAgICAgYiA9IHBpeGVsc1tvZmZzZXQgKyAyXTtcclxuICAgICAgICAgICAgICBhID0gcGl4ZWxzW29mZnNldCArIDNdO1xyXG4gICAgICAgICAgICAgIGlmIChzaG91bGRJZ25vcmUociwgZywgYiwgYSkpIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgIHJ2YWwgPSByID4+IHJzaGlmdDtcclxuICAgICAgICAgICAgICBndmFsID0gZyA+PiByc2hpZnQ7XHJcbiAgICAgICAgICAgICAgYnZhbCA9IGIgPj4gcnNoaWZ0O1xyXG4gICAgICAgICAgICAgIGlmIChydmFsIDwgcm1pbikgcm1pbiA9IHJ2YWw7XHJcbiAgICAgICAgICAgICAgZWxzZSBpZiAocnZhbCA+IHJtYXgpIHJtYXggPSBydmFsO1xyXG4gICAgICAgICAgICAgIGlmIChndmFsIDwgZ21pbikgZ21pbiA9IGd2YWw7XHJcbiAgICAgICAgICAgICAgZWxzZSBpZiAoZ3ZhbCA+IGdtYXgpIGdtYXggPSBndmFsO1xyXG4gICAgICAgICAgICAgIGlmIChidmFsIDwgYm1pbikgYm1pbiA9IGJ2YWw7XHJcbiAgICAgICAgICAgICAgZWxzZSBpZiAoYnZhbCA+IGJtYXgpIGJtYXggPSBidmFsO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIHdoaWxlIChpIDwgcGl4ZWxDb3VudCkge1xyXG4gICAgICAgICAgICAgIG9mZnNldCA9IGkgKiA0O1xyXG4gICAgICAgICAgICAgIGkrKztcclxuICAgICAgICAgICAgICByID0gcGl4ZWxzW29mZnNldCArIDBdO1xyXG4gICAgICAgICAgICAgIGcgPSBwaXhlbHNbb2Zmc2V0ICsgMV07XHJcbiAgICAgICAgICAgICAgYiA9IHBpeGVsc1tvZmZzZXQgKyAyXTtcclxuICAgICAgICAgICAgICBhID0gcGl4ZWxzW29mZnNldCArIDNdO1xyXG4gICAgICAgICAgICAgIHJ2YWwgPSByID4+IHJzaGlmdDtcclxuICAgICAgICAgICAgICBndmFsID0gZyA+PiByc2hpZnQ7XHJcbiAgICAgICAgICAgICAgYnZhbCA9IGIgPj4gcnNoaWZ0O1xyXG4gICAgICAgICAgICAgIGlmIChydmFsIDwgcm1pbikgcm1pbiA9IHJ2YWw7XHJcbiAgICAgICAgICAgICAgZWxzZSBpZiAocnZhbCA+IHJtYXgpIHJtYXggPSBydmFsO1xyXG4gICAgICAgICAgICAgIGlmIChndmFsIDwgZ21pbikgZ21pbiA9IGd2YWw7XHJcbiAgICAgICAgICAgICAgZWxzZSBpZiAoZ3ZhbCA+IGdtYXgpIGdtYXggPSBndmFsO1xyXG4gICAgICAgICAgICAgIGlmIChidmFsIDwgYm1pbikgYm1pbiA9IGJ2YWw7XHJcbiAgICAgICAgICAgICAgZWxzZSBpZiAoYnZhbCA+IGJtYXgpIGJtYXggPSBidmFsO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4gbmV3IFZCb3gocm1pbiwgcm1heCwgZ21pbiwgZ21heCwgYm1pbiwgYm1heCwgaGlzdG8pO1xyXG4gICAgfVxyXG5cclxuICAgIGZ1bmN0aW9uIG1lZGlhbkN1dEFwcGx5KGhpc3RvLCB2Ym94KSB7XHJcbiAgICAgICAgaWYgKCF2Ym94LmNvdW50KCkpIHJldHVybjtcclxuXHJcbiAgICAgICAgdmFyIHJ3ID0gdmJveC5yMiAtIHZib3gucjEgKyAxLFxyXG4gICAgICAgICAgICBndyA9IHZib3guZzIgLSB2Ym94LmcxICsgMSxcclxuICAgICAgICAgICAgYncgPSB2Ym94LmIyIC0gdmJveC5iMSArIDEsXHJcbiAgICAgICAgICAgIG1heHcgPSBwdi5tYXgoW3J3LCBndywgYnddKTtcclxuICAgICAgICAvLyBvbmx5IG9uZSBwaXhlbCwgbm8gc3BsaXRcclxuICAgICAgICBpZiAodmJveC5jb3VudCgpID09IDEpIHtcclxuICAgICAgICAgICAgcmV0dXJuIFt2Ym94LmNvcHkoKV1cclxuICAgICAgICB9XHJcbiAgICAgICAgLyogRmluZCB0aGUgcGFydGlhbCBzdW0gYXJyYXlzIGFsb25nIHRoZSBzZWxlY3RlZCBheGlzLiAqL1xyXG4gICAgICAgIHZhciB0b3RhbCA9IDAsXHJcbiAgICAgICAgICAgIHBhcnRpYWxzdW0sXHJcbiAgICAgICAgICAgIGxvb2thaGVhZHN1bSxcclxuICAgICAgICAgICAgaSwgaiwgaywgc3VtLCBpbmRleDtcclxuICAgICAgICAvLyB2YXIgRCA9IFsncicsICdnJywgJ2InXSxcclxuICAgICAgICAvLyAgIGluZGV4ZXIgPSBnZXRDb2xvckluZGV4O1xyXG4gICAgICAgIC8vIGlmIChtYXh3ID09IGd3KSB7XHJcbiAgICAgICAgLy8gICBEID0gWydnJywgJ3InLCAnYiddO1xyXG4gICAgICAgIC8vICAgaW5kZXhlciA9IGZ1bmN0aW9uKGcsIHIsIGIpIHsgcmV0dXJuIGdldENvbG9ySW5kZXgociwgZywgYik7IH07XHJcbiAgICAgICAgLy8gfSBlbHNlIGlmIChtYXh3ID09IGJ3KSB7XHJcbiAgICAgICAgLy8gICBpbmRleGVyID0gZnVuY3Rpb24oYiwgciwgZykgeyByZXR1cm4gZ2V0Q29sb3JJbmRleChyLCBnLCBiKTsgfTtcclxuICAgICAgICAvLyAgIEQgPSBbJ2InLCAncicsICdnJ107XHJcbiAgICAgICAgLy8gfVxyXG4gICAgICAgIC8vIHBhcnRpYWxzdW0gPSBuZXcgVWludDMyQXJyYXkodmJveFtEWzBdICsgXCIyXCJdICsgMSk7XHJcbiAgICAgICAgLy8gY29uc29sZS5sb2codmJveFtEWzBdICsgXCIyXCJdKVxyXG4gICAgICAgIC8vIGZvciAoaSA9IHZib3hbRFswXSArIFwiMVwiXTsgaSA8PSB2Ym94W0RbMF0gKyBcIjJcIl07IGkrKykge1xyXG4gICAgICAgIC8vICAgICBzdW0gPSAwO1xyXG4gICAgICAgIC8vICAgICBmb3IgKGogPSB2Ym94W0RbMV0gKyBcIjFcIl07IGogPD0gdmJveFtEWzFdICsgXCIyXCJdOyBqKyspIHtcclxuICAgICAgICAvLyAgICAgICAgIGZvciAoayA9IHZib3hbRFsyXSArIFwiMVwiXTsgayA8PSB2Ym94W0RbMl0gKyBcIjJcIl07IGsrKykge1xyXG4gICAgICAgIC8vICAgICAgICAgICAgIGluZGV4ID0gaW5kZXhlcihpLCBqLCBrKTtcclxuICAgICAgICAvLyAgICAgICAgICAgICBzdW0gKz0gaGlzdG9baW5kZXhdO1xyXG4gICAgICAgIC8vICAgICAgICAgfVxyXG4gICAgICAgIC8vICAgICB9XHJcbiAgICAgICAgLy8gICAgIHRvdGFsICs9IHN1bTtcclxuICAgICAgICAvLyAgICAgY29uc29sZS5sb2coaSArIFwiLT5cIiArIHRvdGFsKVxyXG4gICAgICAgIC8vICAgICBwYXJ0aWFsc3VtW2ldID0gdG90YWw7XHJcbiAgICAgICAgLy8gfVxyXG4gICAgICAgIHZhciBtYXhkID0gJ2InO1xyXG4gICAgICAgIGlmIChtYXh3ID09IHJ3KSB7XHJcbiAgICAgICAgICAgIG1heGQgPSAncic7XHJcbiAgICAgICAgICAgIHBhcnRpYWxzdW0gPSBuZXcgVWludDMyQXJyYXkodmJveC5yMiArIDEpO1xyXG4gICAgICAgICAgICBmb3IgKGkgPSB2Ym94LnIxOyBpIDw9IHZib3gucjI7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgc3VtID0gMDtcclxuICAgICAgICAgICAgICAgIGZvciAoaiA9IHZib3guZzE7IGogPD0gdmJveC5nMjsgaisrKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZm9yIChrID0gdmJveC5iMTsgayA8PSB2Ym94LmIyOyBrKyspIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaW5kZXggPSBnZXRDb2xvckluZGV4KGksIGosIGspO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdW0gKz0gaGlzdG9baW5kZXhdO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHRvdGFsICs9IHN1bTtcclxuICAgICAgICAgICAgICAgIHBhcnRpYWxzdW1baV0gPSB0b3RhbDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gZWxzZSBpZiAobWF4dyA9PSBndykge1xyXG4gICAgICAgICAgICBtYXhkID0gJ2cnO1xyXG4gICAgICAgICAgICBwYXJ0aWFsc3VtID0gbmV3IFVpbnQzMkFycmF5KHZib3guZzIgKyAxKTtcclxuICAgICAgICAgICAgZm9yIChpID0gdmJveC5nMTsgaSA8PSB2Ym94LmcyOyBpKyspIHtcclxuICAgICAgICAgICAgICAgIHN1bSA9IDA7XHJcbiAgICAgICAgICAgICAgICBmb3IgKGogPSB2Ym94LnIxOyBqIDw9IHZib3gucjI7IGorKykge1xyXG4gICAgICAgICAgICAgICAgICAgIGZvciAoayA9IHZib3guYjE7IGsgPD0gdmJveC5iMjsgaysrKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGluZGV4ID0gZ2V0Q29sb3JJbmRleChqLCBpLCBrKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3VtICs9IGhpc3RvW2luZGV4XTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB0b3RhbCArPSBzdW07XHJcbiAgICAgICAgICAgICAgICBwYXJ0aWFsc3VtW2ldID0gdG90YWw7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGVsc2UgeyAvKiBtYXh3ID09IGJ3ICovXHJcbiAgICAgICAgICAgIC8vIG1heGQgPSAnYic7XHJcbiAgICAgICAgICAgIHBhcnRpYWxzdW0gPSBuZXcgVWludDMyQXJyYXkodmJveC5iMiArIDEpO1xyXG4gICAgICAgICAgICBmb3IgKGkgPSB2Ym94LmIxOyBpIDw9IHZib3guYjI7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgc3VtID0gMDtcclxuICAgICAgICAgICAgICAgIGZvciAoaiA9IHZib3gucjE7IGogPD0gdmJveC5yMjsgaisrKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZm9yIChrID0gdmJveC5nMTsgayA8PSB2Ym94LmcyOyBrKyspIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaW5kZXggPSBnZXRDb2xvckluZGV4KGosIGssIGkpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBzdW0gKz0gaGlzdG9baW5kZXhdO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIHRvdGFsICs9IHN1bTtcclxuICAgICAgICAgICAgICAgIHBhcnRpYWxzdW1baV0gPSB0b3RhbDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICB2YXIgc3BsaXRQb2ludCA9IC0xO1xyXG4gICAgICAgIGxvb2thaGVhZHN1bSA9IG5ldyBVaW50MzJBcnJheShwYXJ0aWFsc3VtLmxlbmd0aCk7XHJcbiAgICAgICAgZm9yIChpID0gMDsgaSA8IHBhcnRpYWxzdW0ubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICAgIHZhciBkID0gcGFydGlhbHN1bVtpXTtcclxuICAgICAgICAgIGlmIChzcGxpdFBvaW50IDwgMCAmJiBkID4gKHRvdGFsIC8gMikpIHNwbGl0UG9pbnQgPSBpO1xyXG4gICAgICAgICAgbG9va2FoZWFkc3VtW2ldID0gdG90YWwgLSBkXHJcbiAgICAgICAgfVxyXG4gICAgICAgIC8vIHBhcnRpYWxzdW0uZm9yRWFjaChmdW5jdGlvbihkLCBpKSB7XHJcbiAgICAgICAgLy8gICBpZiAoc3BsaXRQb2ludCA8IDAgJiYgZCA+ICh0b3RhbCAvIDIpKSBzcGxpdFBvaW50ID0gaVxyXG4gICAgICAgIC8vICAgICBsb29rYWhlYWRzdW1baV0gPSB0b3RhbCAtIGRcclxuICAgICAgICAvLyB9KTtcclxuXHJcbiAgICAgICAgLy8gY29uc29sZS5sb2coJ2N1dCcpXHJcbiAgICAgICAgZnVuY3Rpb24gZG9DdXQoY29sb3IpIHtcclxuICAgICAgICAgICAgdmFyIGRpbTEgPSBjb2xvciArICcxJyxcclxuICAgICAgICAgICAgICAgIGRpbTIgPSBjb2xvciArICcyJyxcclxuICAgICAgICAgICAgICAgIGxlZnQsIHJpZ2h0LCB2Ym94MSwgdmJveDIsIGQyLCBjb3VudDIgPSAwLFxyXG4gICAgICAgICAgICAgICAgaSA9IHNwbGl0UG9pbnQ7XHJcbiAgICAgICAgICAgIHZib3gxID0gdmJveC5jb3B5KCk7XHJcbiAgICAgICAgICAgIHZib3gyID0gdmJveC5jb3B5KCk7XHJcbiAgICAgICAgICAgIGxlZnQgPSBpIC0gdmJveFtkaW0xXTtcclxuICAgICAgICAgICAgcmlnaHQgPSB2Ym94W2RpbTJdIC0gaTtcclxuICAgICAgICAgICAgaWYgKGxlZnQgPD0gcmlnaHQpIHtcclxuICAgICAgICAgICAgICAgIGQyID0gTWF0aC5taW4odmJveFtkaW0yXSAtIDEsIH5+IChpICsgcmlnaHQgLyAyKSk7XHJcbiAgICAgICAgICAgICAgICBkMiA9IE1hdGgubWF4KDAsIGQyKTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIGQyID0gTWF0aC5tYXgodmJveFtkaW0xXSwgfn4gKGkgLSAxIC0gbGVmdCAvIDIpKTtcclxuICAgICAgICAgICAgICAgIGQyID0gTWF0aC5taW4odmJveFtkaW0yXSwgZDIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKHBhcnRpYWxzdW1bZDJdKVxyXG4gICAgICAgICAgICAvLyBhdm9pZCAwLWNvdW50IGJveGVzXHJcbiAgICAgICAgICAgIHdoaWxlICghcGFydGlhbHN1bVtkMl0pIGQyKys7XHJcbiAgICAgICAgICAgIGNvdW50MiA9IGxvb2thaGVhZHN1bVtkMl07XHJcbiAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCctXy0nKVxyXG4gICAgICAgICAgICB3aGlsZSAoIWNvdW50MiAmJiBwYXJ0aWFsc3VtW2QyIC0gMV0pIGNvdW50MiA9IGxvb2thaGVhZHN1bVstLWQyXTtcclxuICAgICAgICAgICAgLy8gc2V0IGRpbWVuc2lvbnNcclxuICAgICAgICAgICAgdmJveDFbZGltMl0gPSBkMjtcclxuICAgICAgICAgICAgdmJveDJbZGltMV0gPSB2Ym94MVtkaW0yXSArIDE7XHJcbiAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCd2Ym94IGNvdW50czonLCB2Ym94LmNvdW50KCksIHZib3gxLmNvdW50KCksIHZib3gyLmNvdW50KCkpO1xyXG4gICAgICAgICAgICByZXR1cm4gW3Zib3gxLCB2Ym94Ml07XHJcblxyXG4gICAgICAgIH1cclxuICAgICAgICAvLyBkZXRlcm1pbmUgdGhlIGN1dCBwbGFuZXNcclxuICAgICAgICByZXR1cm4gZG9DdXQobWF4ZCk7XHJcbiAgICAgICAgLy8gcmV0dXJuIG1heHcgPT0gcncgPyBkb0N1dCgncicpIDpcclxuICAgICAgICAvLyAgICAgbWF4dyA9PSBndyA/IGRvQ3V0KCdnJykgOlxyXG4gICAgICAgIC8vICAgICBkb0N1dCgnYicpO1xyXG4gICAgfVxyXG5cclxuICAgIGZ1bmN0aW9uIHF1YW50aXplKHBpeGVscywgb3B0cykge1xyXG4gICAgICAgIHZhciBtYXhjb2xvcnMgPSBvcHRzLmNvbG9yQ291bnQ7XHJcbiAgICAgICAgLy8gc2hvcnQtY2lyY3VpdFxyXG4gICAgICAgIGlmICghcGl4ZWxzLmxlbmd0aCB8fCBtYXhjb2xvcnMgPCAyIHx8IG1heGNvbG9ycyA+IDI1Nikge1xyXG4gICAgICAgICAgICAvLyBjb25zb2xlLmxvZygnd3JvbmcgbnVtYmVyIG9mIG1heGNvbG9ycycpO1xyXG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICB2YXIgaGFzRmlsdGVycyA9IEFycmF5LmlzQXJyYXkob3B0cy5maWx0ZXJzKSAmJiBvcHRzLmZpbHRlcnMubGVuZ3RoID4gMDtcclxuICAgICAgICBmdW5jdGlvbiBzaG91bGRJZ25vcmUociwgZywgYiwgYSkge1xyXG4gICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBvcHRzLmZpbHRlcnMubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICAgICAgdmFyIGYgPSBvcHRzLmZpbHRlcnNbaV07XHJcbiAgICAgICAgICAgIGlmICghZihyLCBnLCBiLCBhKSkge1xyXG4gICAgICAgICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICB2YXIgciA9IGdldEFsbChwaXhlbHMsIGhhc0ZpbHRlcnMgPyBob3VsZElnbm9yZSA6IG51bGwpO1xyXG4gICAgICAgIC8vIFhYWDogY2hlY2sgY29sb3IgY29udGVudCBhbmQgY29udmVydCB0byBncmF5c2NhbGUgaWYgaW5zdWZmaWNpZW50XHJcblxyXG4gICAgICAgIC8vIHZhciBoaXN0byA9IGdldEhpc3RvKHBpeGVscywgaGFzRmlsdGVycyA/IHNob3VsZElnbm9yZSA6IG51bGwpLFxyXG4gICAgICAgIHZhciBoaXN0byA9IHIuaGlzdG8sXHJcbiAgICAgICAgICAgIGhpc3Rvc2l6ZSA9IDEgPDwgKDMgKiBzaWdiaXRzKTtcclxuXHJcbiAgICAgICAgLy8gY2hlY2sgdGhhdCB3ZSBhcmVuJ3QgYmVsb3cgbWF4Y29sb3JzIGFscmVhZHlcclxuICAgICAgICB2YXIgbkNvbG9ycyA9IE9iamVjdC5rZXlzKGhpc3RvKS5sZW5ndGg7XHJcbiAgICAgICAgaWYgKG5Db2xvcnMgPD0gbWF4Y29sb3JzKSB7XHJcbiAgICAgICAgICAgIC8vIFhYWDogZ2VuZXJhdGUgdGhlIG5ldyBjb2xvcnMgZnJvbSB0aGUgaGlzdG8gYW5kIHJldHVyblxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gZ2V0IHRoZSBiZWdpbm5pbmcgdmJveCBmcm9tIHRoZSBjb2xvcnNcclxuICAgICAgICAvLyB2YXIgdmJveCA9IHZib3hGcm9tUGl4ZWxzKHBpeGVscywgaGlzdG8sIGhhc0ZpbHRlcnMgPyBzaG91bGRJZ25vcmUgOiBudWxsKSxcclxuICAgICAgICB2YXIgdmJveCA9IHIudmJveCxcclxuICAgICAgICAgICAgcHEgPSBuZXcgUFF1ZXVlKGZ1bmN0aW9uKGEsIGIpIHtcclxuICAgICAgICAgICAgICAgIHJldHVybiBwdi5uYXR1cmFsT3JkZXIoYS5jb3VudCgpLCBiLmNvdW50KCkpXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIHBxLnB1c2godmJveCk7XHJcblxyXG4gICAgICAgIC8vIGlubmVyIGZ1bmN0aW9uIHRvIGRvIHRoZSBpdGVyYXRpb25cclxuXHJcbiAgICAgICAgZnVuY3Rpb24gaXRlcihsaCwgdGFyZ2V0KSB7XHJcbiAgICAgICAgICAgIHZhciBuY29sb3JzID0gMSxcclxuICAgICAgICAgICAgICAgIG5pdGVycyA9IDAsXHJcbiAgICAgICAgICAgICAgICB2Ym94O1xyXG4gICAgICAgICAgICB3aGlsZSAobml0ZXJzIDwgbWF4SXRlcmF0aW9ucykge1xyXG4gICAgICAgICAgICAgICAgdmJveCA9IGxoLnBvcCgpO1xyXG4gICAgICAgICAgICAgICAgaWYgKCF2Ym94LmNvdW50KCkpIHsgLyoganVzdCBwdXQgaXQgYmFjayAqL1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIGxoLnB1c2godmJveCk7IC8vIE1heWJlIG5vdFxyXG4gICAgICAgICAgICAgICAgICAgIG5pdGVycysrO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgLy8gZG8gdGhlIGN1dFxyXG4gICAgICAgICAgICAgICAgdmFyIHZib3hlcyA9IG1lZGlhbkN1dEFwcGx5KGhpc3RvLCB2Ym94KSxcclxuICAgICAgICAgICAgICAgICAgICB2Ym94MSA9IHZib3hlc1swXSxcclxuICAgICAgICAgICAgICAgICAgICB2Ym94MiA9IHZib3hlc1sxXTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZiAoIXZib3gxKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gY29uc29sZS5sb2coXCJ2Ym94MSBub3QgZGVmaW5lZDsgc2hvdWxkbid0IGhhcHBlbiFcIik7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgbGgucHVzaCh2Ym94MSk7XHJcbiAgICAgICAgICAgICAgICBpZiAodmJveDIpIHsgLyogdmJveDIgY2FuIGJlIG51bGwgKi9cclxuICAgICAgICAgICAgICAgICAgICBsaC5wdXNoKHZib3gyKTtcclxuICAgICAgICAgICAgICAgICAgICBuY29sb3JzKys7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBpZiAobmNvbG9ycyA+PSB0YXJnZXQpIHJldHVybjtcclxuICAgICAgICAgICAgICAgIGlmIChuaXRlcnMrKyA+IG1heEl0ZXJhdGlvbnMpIHtcclxuICAgICAgICAgICAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIGZpcnN0IHNldCBvZiBjb2xvcnMsIHNvcnRlZCBieSBwb3B1bGF0aW9uXHJcbiAgICAgICAgaXRlcihwcSwgZnJhY3RCeVBvcHVsYXRpb25zICogbWF4Y29sb3JzKTtcclxuICAgICAgICAvLyBjb25zb2xlLmxvZyhwcS5zaXplKCksIHBxLmRlYnVnKCkubGVuZ3RoLCBwcS5kZWJ1ZygpLnNsaWNlKCkpO1xyXG5cclxuICAgICAgICAvLyBSZS1zb3J0IGJ5IHRoZSBwcm9kdWN0IG9mIHBpeGVsIG9jY3VwYW5jeSB0aW1lcyB0aGUgc2l6ZSBpbiBjb2xvciBzcGFjZS5cclxuICAgICAgICB2YXIgcHEyID0gbmV3IFBRdWV1ZShmdW5jdGlvbihhLCBiKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBwdi5uYXR1cmFsT3JkZXIoYS5jb3VudCgpICogYS52b2x1bWUoKSwgYi5jb3VudCgpICogYi52b2x1bWUoKSlcclxuICAgICAgICB9KTtcclxuICAgICAgICB3aGlsZSAocHEuc2l6ZSgpKSB7XHJcbiAgICAgICAgICAgIHBxMi5wdXNoKHBxLnBvcCgpKTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIG5leHQgc2V0IC0gZ2VuZXJhdGUgdGhlIG1lZGlhbiBjdXRzIHVzaW5nIHRoZSAobnBpeCAqIHZvbCkgc29ydGluZy5cclxuICAgICAgICBpdGVyKHBxMiwgbWF4Y29sb3JzIC0gcHEyLnNpemUoKSk7XHJcblxyXG4gICAgICAgIC8vIGNhbGN1bGF0ZSB0aGUgYWN0dWFsIGNvbG9yc1xyXG4gICAgICAgIHZhciBjbWFwID0gbmV3IENNYXAoKTtcclxuICAgICAgICB3aGlsZSAocHEyLnNpemUoKSkge1xyXG4gICAgICAgICAgICB2YXIgdiA9IHBxMi5wb3AoKSxcclxuICAgICAgICAgICAgICBjID0gdmJveC5hdmcoKTtcclxuICAgICAgICAgICAgaWYgKCFoYXNGaWx0ZXJzIHx8ICFzaG91bGRJZ25vcmUoY1swXSwgY1sxXSwgY1syXSwgMjU1KSkge1xyXG4gICAgICAgICAgICAgIGNtYXAucHVzaCh2KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIGNtYXA7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgICBxdWFudGl6ZTogcXVhbnRpemUsXHJcbiAgICAgICAgZ2V0QWxsOiBnZXRBbGwsXHJcbiAgICAgICAgbWVkaWFuQ3V0QXBwbHk6IG1lZGlhbkN1dEFwcGx5XHJcbiAgICB9XHJcbn0pKCk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IE1NQ1EucXVhbnRpemVcclxubW9kdWxlLmV4cG9ydHMuZ2V0QWxsID0gTU1DUS5nZXRBbGxcclxubW9kdWxlLmV4cG9ydHMuc3BsaXRCb3ggPSBNTUNRLm1lZGlhbkN1dEFwcGx5XHJcbiJdfQ==
