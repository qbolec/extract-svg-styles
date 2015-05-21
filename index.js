'use strict';

var vfs = require('vinyl-fs');
var fs = require('graceful-fs');
var through2 = require('through2');
var cheerio = require('cheerio');
var mkdirp = require('mkdirp');
var path = require('path');
var css = require('css');
var _ = require('lodash');

var opt;
var streaming = false;
var defaults = {
    src: false,
    out: {
        svg: false,
        style: false
    },
    extension: 'css',
    classPrefix: '',
    idHandling: 'none' // 'none', 'class', 'remove', 'prefix'
};

var cherioOpts = {
    xmlMode: false,
    lowerCaseTags: false,   // don't change the camelCase tag- and attribute names, since chrome only respects camels!
    lowerCaseAttributeNames: false // s.a.
};

// File name without extension
function identifier (fullPath) {
    return path.basename(fullPath, path.extname(fullPath));
}

function className (filepath) {
    return opt.classPrefix + identifier(filepath);
}

function writeFile (name, contents, cb) {
    mkdirp(path.dirname(name), function () {
        fs.writeFile(name, contents, cb);
    });
}

function writeSVG (name, contents, cb) {
    var destination = path.join(opt.out.svg, path.basename(name));
    writeFile(destination, contents, cb);
}

function writeCSS (svgPath, contents, cb) {
    var destination = path.join(opt.out.style, identifier(svgPath) + '.' + opt.extension);
    if (contents) {
        writeFile(destination, contents, cb);
    }
}

function nestCSS (prefix, contents) {
    var parsed = css.parse(contents);
    _.forEach(parsed.stylesheet.rules, function (rule) {
        rule.selectors = _.map(rule.selectors, function (selector) {
            return prefix + ' ' + selector;
        });
    });
    return css.stringify(parsed);
}

function prefixIdOfElem ($elem, id, file, replacedIds) {
    var prefixedId = identifier(file.path) + '-' + id;
    $elem.attr('id', prefixedId);
    replacedIds[id] = prefixedId;
}

function removeCDATA (file) {
    var content = file.contents.toString().replace('<![CDATA[', '');
    content = content.replace(']]>', '');
    file.contents = new Buffer(content);
}

function handleIDs (file) {
    if (opt.idHandling === 'none') return;
    var replacedIds = {};
    var editedFileContent;
    var $ = cheerio.load(file.contents, cherioOpts);
    $('[id]').each(function (index, item) {
        var $item = $(item);
        var id = $item.attr('id');
        switch (opt.idHandling) {
            case 'class' :
                // do not remove ids of gradients since they are targeted from styles via "fill: url(#id)"
                if($item[0].tagName.toLowerCase().indexOf('gradient') >= 0 ) {
                    prefixIdOfElem($item, id, file, replacedIds);
                }
                else{
                    $item.addClass(id);
                    $item.removeAttr('id');
                }
                break;
            case 'remove' :
                $item.removeAttr('id');
                break;
            case 'prefix' :
                prefixIdOfElem($item, id, file, replacedIds);
                break;
        }
    });

    editedFileContent = $.html();
    for(var oldId in replacedIds) {
        editedFileContent = editedFileContent.replace('#'+oldId, '#'+replacedIds[oldId]);
    }
    file.contents = new Buffer(editedFileContent);
}

function extractStyle (file) {
    var $ = cheerio.load(file.contents);
    var styleBlocks = $('style');
    return styleBlocks.text();
}

function classedSVG (file, styles) {
    var $ = cheerio.load(file.contents, cherioOpts);
    $('svg').addClass(className(file.path));
    $('style').text(styles);
    return $.html();
}

function extractStyles (file, enc, cb) {
    var finished = _.after(2, cb);
    removeCDATA(file);
    handleIDs(file);
    var styleText = nestCSS('.' + className(file.path), extractStyle(file));

    if (opt.out.svg) {
        writeSVG(file.path, new Buffer(classedSVG(file, styleText)), finished);
    } else {
        file.contents = new Buffer(classedSVG(file, styleText));
        finished();
    }

    writeCSS(file.path, (styleText ? new Buffer(styleText) : null), finished);

    this.push(file);
}

function prepareOptions (options) {
    return _.assign(defaults, options);
}

var stream = {
    extract: function (options) {
        streaming = true;
        opt = prepareOptions(options);
        opt.out.style = options.styleDest;
        return through2.obj(extractStyles);
    }
};

var run = function (options, done) {
    opt = prepareOptions(options);

    vfs.src(opt.src)
        .pipe(through2.obj(extractStyles, done));
};

module.exports = {
    extract: run,
    stream: stream
};
