var fs = require('fs'),
    syspath = require('path'),
    extend = require('extend'),
    request = require('request'),
    async = require('async'),
    targz = require('tar.gz'),
    cpr = require('cpr').cpr,
    spawn = require('child_process').spawn;

var BASE_URL = 'http://ued.qunar.com/qapp-source/';

var isWin32 = process.platform === "win32";
    c = console.info;

function fixCmd(cmd) {
    return isWin32 ? cmd + '.cmd' : cmd;
}

function getWidgetAliasName(name) {
    return name.replace(/\w/, function(a) {
        return a.toUpperCase();
    }) + 'Widget';
}

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

function rewriteConfig(config, newConfig, root) {
    extend(true, config, newConfig);
    fs.writeFileSync(syspath.join(root, 'fekit.config'), JSON.stringify(config, {}, 4), 'UTF-8');
}

function showList(config, type) {
    return function(cb) {
        var url = BASE_URL + type + 's/info.config';
        c('- 获取列表 ...');
        request(url, function(err, res, body) {
            if (!err && res.statusCode === 200) {
                var info = {};
                try {
                    info = JSON.parse(body);
                } catch (e) {
                    c(' * [ERROR]信息内容解析失败。');
                }
                if (info.list && info.list.length) {
                    info.list.forEach(function(item) {
                        c(item.name + '\t' + item.version + '\t' + item.description);
                    });
                }
            } else {
                c(' * [ERROR]获取列表信息失败。');
            }
            cb(null);
        });
    };
}

function installQAppModule(config, path, root) {
    return function(cb) {
        c('- 本地更新QApp ...');
        fs.lstat(path, function(err, stat) {
            if (err) {
                c(' * [ERROR]文件或目录不存在。');
                cb(null);
            } else {
                if (stat.isDirectory()) {
                    cpr(path, syspath.join(root, './fekit_modules/QApp'), {
                        deleteFirst: true
                    }, function(err) {
                        if (err) {
                            c(' * [ERROR]文件复制失败。');
                        } else {
                            c(' * 文件复制成功。');
                            c(' * 更新成功。');
                        }
                        cb(null);
                    });
                } else {
                    if (~path.indexOf('.tar.gz')) {
                        deleteFolderRecursive(syspath.join(root, './fekit_modules/QApp'));
                        new targz().extract(
                            path,
                            syspath.join(root, './tmp/QApp'),
                            function(err) {
                                if (err) {
                                    c(' * [ERROR]: ', err);
                                    c(' * [ERROR]解压包失败。');
                                    cb(null);
                                } else {
                                    c(' * 解压完毕。');
                                    cpr(syspath.join(root, './tmp/QApp/qapp-framework'), syspath.join(root, './fekit_modules/QApp'), {
                                        deleteFirst: true
                                    }, function(err) {
                                        if (err) {
                                            c(' * [ERROR]文件复制失败。');
                                        } else {
                                            c(' * 文件复制成功。');
                                            c(' * 更新成功。');
                                        }
                                        cb(null);
                                    });
                                }
                            }
                        );
                    } else {
                        c(' * [ERROR]请选择 tar.gz 文件。');
                        cb(null);
                    }
                }
            }
        });
    };
}

function updateQAppModule(config, version, root) {
    return function(cb) {
        var script,
            params = ['install', 'QApp'];
        c('- Fekit 升级 QApp:');
        if (version) {
            c(' * 改写 Fekit QApp 依赖配置。');
            rewriteConfig(config, {
                dependencies: {
                    QApp: version
                }
            }, root);
            params.push('-c');
        }
        c(' * 运行 Fekit Install 命令 ...');
        script = spawn(fixCmd('fekit'), params);
        script.stdout.on('data', function(chunk) {
            var line = chunk + '';
            line = line.replace('\n', '');
            if (line.length) {
                c(' * ' + line);
            }
        });
        script.stdout.on('end', function(chunk) {
            cb(null);
        });
    };
}

function showWidgetInfo(config, name, root) {
    return function(cb) {
        c('');
        c('- 显示' + name + '组件信息 ...');
        var widgetConfig = {};
        try {
            widgetConfig = JSON.parse(fs.readFileSync(syspath.join(root, 'src', 'widgets', name, 'widget.config')));
            c(' * 组件组名: ' + (widgetConfig.name || ''));
            c(' * 描述: ' + (widgetConfig.description || '无'));
            c(' * 版本: ' + (widgetConfig.version || '未知'));
            c(' * 更新时间: ' + (widgetConfig.update_time || '未知'));
            c(' * 输出: ');
            widgetConfig.exports.forEach(function(item, index) {
                c('  * -- ' + (index + 1) + ' --');
                c('  * 名称: ' + item.name + ' \t描述名: ' + (item.description || '无') + ' \t包含组件: ' + item.widgets.join(', '));
                c('  * 脚本: ' + ((item.script && item.script.replace('./exports', getWidgetAliasName(name))) || '无') + ' \t样式: ' + ((item.style && item.style.replace('./exports', getWidgetAliasName(name))) || '无'));
                c('  * 备注: ' + (item.mark || '无'));
            });
            cb(null);
        } catch(e) {
            c(' * [ERROR]读取解析组件信息失败！');
            cb(c);
        }
    };
}

function installWidgets(config, widgets, root) {

    return function(cb) {
        var taskList = [];

        if (!fs.existsSync(syspath.join(root, './src'))) {
            fs.mkdirSync(syspath.join(root, './src'));
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
                    encoding: null
                }, function(err, res, body) {
                    if (!err && res.statusCode === 200) {
                        c(' * 下载文件成功。');
                        console.log(syspath.join(root, './tmp/' + widget.name + '-' + widget.version + '.tar.gz'));
                        fs.writeFileSync(syspath.join(root, './tmp/' + widget.name + '-' + widget.version + '.tar.gz'), body);
                        new targz().extract(
                            syspath.join(root, './tmp/' + widget.name + '-' + widget.version + '.tar.gz'),
                            syspath.join(root, './src/widgets/'),
                            function(err) {
                                if (err) {
                                    c(' * [ERROR]: ', err);
                                    c(' * [ERROR]安装 ' + widget.name + ' 组件失败。');
                                } else {
                                    if (fs.existsSync(syspath.join(root, './src/widgets/' + widget.name))) {
                                        deleteFolderRecursive(syspath.join(root, './src/widgets/' + widget.name));
                                    }
                                    fs.renameSync(syspath.join(root, './src/widgets/src'), syspath.join(root, './src/widgets/' + widget.name));

                                    var alias = {};
                                    alias[getWidgetAliasName(widget.name)] = 'src/widgets/' + widget.name;

                                    c(' * 写入组件 Alias 路径 - ' + getWidgetAliasName(widget.name) + ' : src/widgets/' + widget.name);
                                    rewriteConfig(config, {
                                        alias: alias
                                    }, root);
                                    c(' * 安装 ' + widget.name + ' 组件成功。');
                                }
                                callback(null);
                            }
                        );
                    } else {
                        c(' * 下载文件失败。');
                        c(' * 安装 ' + widget.name + ' 组件失败。');
                        callback(null);
                    }
                });
            });
        });

        c('- 开始安装 QApp 组件: ');
        async.series(taskList, function(err, results) {
            c(' * 全部组件安装完成！');
            cb(null);
        });
    };
}

function showYoInfo(config, root) {
    return function(cb) {
        c('');
        c('- 显示 Yo 信息 ...');
        var config = {};
        try {
            config = JSON.parse(fs.readFileSync(syspath.join(root, 'src', 'yo', 'yo.config')));
            c(' * 版本: ' + (config.version || '未知'));
            c(' * 更新时间: ' + (config.update_time || '未知'));
            cb(null);
        } catch(e) {
            c(' * [ERROR]读取解析组件信息失败！');
            cb(c);
        }
    };
}

function installYo(config, version, root) {
    return function(cb) {
        c('- 开始安装 Yo: ');
        c(' * 开始下载 Yo 源码包，版本 ' + version + ' ...');
        var url = BASE_URL + 'yo/build/yo-' + version + '.map';
        c(' * 下载地址: ' + url.replace('.map', '.tar.gz'));
        request({
            url: url,
            encoding: null
        }, function(err, res, body) {
            if (!err && res.statusCode === 200) {
                c(' * 下载文件成功。');
                fs.writeFileSync(syspath.join(root, './tmp/yo-' + version + '.tar.gz'), body);
                new targz().extract(
                    syspath.join(root, './tmp/yo-' + version + '.tar.gz'),
                    syspath.join(root, './tmp/yo/'),
                    function(err) {
                        if (err) {
                            c(' * [ERROR]: ', err);
                            c(' * [ERROR]安装 Yo 失败。');
                        } else {
                            if (!fs.existsSync(syspath.join(root, './src/yo'))) {
                                fs.mkdirSync(syspath.join(root, './src/yo'));
                            }
                            if (!fs.existsSync(syspath.join(root, './src/yo/usage'))) {
                                fs.mkdirSync(syspath.join(root, './src/yo/usage'));
                            }
                            if (!fs.existsSync(syspath.join(root, './src/yo/usage/exports'))) {
                                fs.mkdirSync(syspath.join(root, './src/yo/usage/exports'));
                            }
                            if (fs.existsSync(syspath.join(root, './src/yo/yo.config'))) {
                                fs.unlinkSync(syspath.join(root, './src/yo/yo.config'));
                            }
                            if (fs.existsSync(syspath.join(root, './src/yo/font'))) {
                                deleteFolderRecursive(syspath.join(root, './src/yo/font'));
                            }
                            if (fs.existsSync(syspath.join(root, './src/yo/lib'))) {
                                deleteFolderRecursive(syspath.join(root, './src/yo/lib'));
                            }
                            fs.renameSync(syspath.join(root, './tmp/yo/src/yo.config'), syspath.join(root, './src/yo/yo.config'));
                            fs.renameSync(syspath.join(root, './tmp/yo/src/font'), syspath.join(root, './src/yo/font'));
                            fs.renameSync(syspath.join(root, './tmp/yo/src/lib'), syspath.join(root, './src/yo/lib'));
                            c(' * 写入 Yo 输出文件 alias - Yo : src/yo/usage/exports');

                            rewriteConfig(config, {
                                alias: {
                                    Yo: 'src/yo/usage/exports'
                                }
                            }, root);

                            c(' * 安装 Yo 成功。');
                        }
                        cb(null);
                    }
                );
            } else {
                c(' * 下载文件失败。');
                c(' * 安装 Yo 失败。');
                cb(null);
            }
        });
    };
}

exports.usage = "QApp工具";

exports.set_options = function(optimist) {

    optimist.alias('l', 'list');
    optimist.describe('l', '查看列表，参数现只可以为 "widget"');

    optimist.alias('i', 'info');
    optimist.describe('i', '查看信息, 参数格式为 "类型:名称"，例如: "widget:basic"');

    optimist.alias('r', 'remote');
    optimist.describe('r', '源地址，默认: http://ued.qunar.com/qapp-source/');

    optimist.alias('w', 'widget');
    optimist.describe('w', '安装/更新组件');

    optimist.alias('u', 'update');
    optimist.describe('u', '从本地升级QApp，参数为本地 QApp 源地址（特殊情况下使用）');

    optimist.alias('y', 'yo');
    optimist.describe('y', '安装/更新Yo');

    return optimist;
};

exports.run = function(options) {
    var root = options.cwd,
        taskList = [];

    options.list = options.l;
    options.remote = options.r;
    options.widget = options.w;
    options.update = options.u;
    options.info = options.i;
    options.yo = options.y;

    var config = {};
    try {
        config = JSON.parse(fs.readFileSync(syspath.join(root, 'fekit.config')));
    } catch (e) {
        c(' * [ERROR]读取 fekit.config 失败。');
        return;
    }

    c('- 检测 QApp 环境:');
    if (config.dependencies && config.dependencies.QApp) {
        c(' * 当前使用 QApp 版本为: ' + config.dependencies.QApp);
    } else {
        c(' * [WARNING]没有引入 QApp 模块。');
    }

    c('-------------------------');

    if (options.remote && options.remote !== true) {
        BASE_URL = options.remote;
    }

    if (options.update) {
        if (options.update !== true) {
            if (options.update.indexOf('v@') === 0) {
                taskList.push(updateQAppModule(config, options.update.substring(2), root));
            } else {
                taskList.push(installQAppModule(config, options.update, root));
            }
        } else {
            taskList.push(updateQAppModule(config));
        }
    }

    if (options.list) {
        if (options.list == 'widget') {
            taskList.push(showList(config, 'widget'));
        }
    }

    if (options.widget) {
        var widgets = [];
        if (options.widget === true) {
            var widgetConfig = config.module_options && config.module_options['QApp-widget'];
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
                c('- [ERROR]参数应为 name@version 形式。');
                return;
            }
            widgets.push({
                name: nv[0],
                version: nv[1]
            });
        }
        taskList.push(installWidgets(config, widgets, root));
        widgets.forEach(function(widget) {
            taskList.push(showWidgetInfo(config, widget.name, root));
        });
    }

    if (options.info && options.info !== true) {
        var kv = options.info.split(':');
        if (kv[0] === 'widget') {
            if (kv.length < 2) {
                c('- [ERROR]参数应为 widget:组件名 形式。');
                return;
            }
            taskList.push(showWidgetInfo(config, kv[1], root));
        } else if (kv[0] === 'yo') {
            taskList.push(showYoInfo(config, root));
        }
    }

    if (options.yo) {
        if (options.yo !== true) {
            if (options.yo.indexOf('v@') === 0) {
                taskList.push(installYo(config, options.yo.substring(2), root));
                taskList.push(showYoInfo(config, root));
            } else if (options.yo === 'info'){
                taskList.push(showYoInfo(config, root));
            }
        } else {
            c('- [ERROR]参数应为 v@0.0.0 形式 或 info。');
        }
    }

    if (!fs.existsSync(syspath.join(root, './tmp'))) {
        fs.mkdirSync(syspath.join(root, './tmp'));
    }

    async.series(taskList, function(err, results) {
        deleteFolderRecursive(syspath.join(root, './tmp'));
        c('-------------------------');
        c('- Love & Enjoy it!');
    });

};
