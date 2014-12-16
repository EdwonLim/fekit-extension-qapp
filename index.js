var fs = require('fs'),
    syspath = require('path'),
    request = require('request'),
    async = require('async'),
    targz = require('tar.gz');

var BASE_URL = 'http://ued.qunar.com/qapp-source/';

var c = console.info;

function deleteFolderRecursive(path) {
    var files = [];
    if (fs.existsSync(path)) {
        files = fs.readdirSync(path);
        files.forEach(function(file, index) {
            var curPath = path + "/" + file;
            if (fs.statSync(curPath).isDirectory()) { // recurse
                deleteFolderRecursive(curPath);
            } else { // delete file
                fs.unlinkSync(curPath);
            }
        });
        fs.rmdirSync(path);
    }
}

function installWidgets(widgets, root) {
    var taskList = [];

    if (!fs.existsSync(syspath.join(root, './tmp'))) {
        fs.mkdirSync(syspath.join(root, './tmp'));
    }

    if (!fs.existsSync(syspath.join(root, './src/widgets'))) {
        fs.mkdirSync(syspath.join(root, './src/widgets'));
    }

    widgets.forEach(function(widget) {
        taskList.push(function(callback) {
            c(' * 开始下载 ' + widget.name + ' 组件包，版本 ' + widget.version + ' ...');
            var url = BASE_URL + 'widgets/' + widget.name + '/build/' + widget.name + '-' + widget.version + '.map';
            c(' * 下载地址: ' + url.replace('.map', '.tar.gz'));
            request({
                url: url,
                encoding : null
            }, function(err, res, body) {
                c(' * 下载文件成功。');
                fs.writeFileSync(syspath.join(root, './tmp/' + widget.name + '-' + widget.version + '.tar.gz'), body);
                new targz().extract(
                    syspath.join(root, './tmp/' + widget.name + '-' + widget.version + '.tar.gz'),
                    syspath.join(root, './src/widgets/'),
                    function(err) {
                        if (err) {
                            c(' * [ERROR]: ', err);
                            c(' * 安装 ' + widget.name + ' 组件失败。');
                        } else {
                            if (fs.existsSync(syspath.join(root, './src/widgets/' + widget.name))) {
                                deleteFolderRecursive(syspath.join(root, './src/widgets/' + widget.name));
                            }
                            fs.renameSync(syspath.join(root, './src/widgets/src'), syspath.join(root, './src/widgets/' + widget.name));
                            c(' * 安装 ' + widget.name + ' 组件成功。');
                        }
                        callback(null);
                    }
                );
            });
        });
    });

    async.series(taskList, function(err, results) {
        deleteFolderRecursive(syspath.join(root, './tmp'));
        console.log(' * 全部组件安装完成！');
    });
}

exports.usage = "QApp工具";

exports.set_options = function(optimist) {
    optimist.alias('w', 'widget');
    optimist.describe('w', '安装组件');
    optimist.alias('r', 'remote');
    optimist.describe('r', '源地址');
    return optimist;
};

exports.run = function(options) {
    var root = options.cwd;

    options.widget = options.w;

    if (options.r && options.r !== true) {
        BASE_URL = options.r;
    }

    if (options.widget) {
        var widgets = [];
        c('- 开始安装 QApp 组件: ');
        if (options.widget === true) {
            var config = {},
                widgetConfig;
            try {
                config = JSON.parse(fs.readFileSync(syspath.join(root, 'fekit.config')));
            } catch (e) {
                c(' * [ERROR]读取 fekit.config 失败。');
                return;
            }
            widgetConfig = config.module_options && config.module_options['QApp-widget'];
            if (widgetConfig) {
                for (var key in widgetConfig) {
                    widgets.push({
                        name: key,
                        version: widgetConfig[key]
                    });
                }
            }
        } else {
            var nv = options.widget.split('@');
            if (nv.length < 2) {
                c(' * [ERROR]参数应为 name@version 形式。');
                return;
            }
            widgets.push({
                name: nv[0],
                version: nv[1]
            });
        }
        installWidgets(widgets, root);
    }

};
