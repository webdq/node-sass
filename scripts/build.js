/*!
 * node-sass: scripts/build.js
 */

var pkg = require('../package.json'),
  fs = require('fs'),
  mkdir = require('mkdirp'),
  path = require('path'),
  spawn = require('cross-spawn'),
  log = require('npmlog'),
  sass = require('../lib/extensions');

/**
 * After build
 *
 * @param {Object} options
 * @api private
 */

function afterBuild(options) {
  var install = sass.getBinaryPath();
  var target = path.join(__dirname, '..', 'build',
    options.debug ? 'Debug' :
        process.config.target_defaults
            ?  process.config.target_defaults.default_configuration
            : 'Release',
    'binding.node');

  mkdir(path.dirname(install), function(err) {
    if (err && err.code !== 'EEXIST') {
      log.error('node-sass build', err.message);
      return;
    }

    fs.stat(target, function(err) {
      if (err) {
        log.error('node-sass build', 'Build succeeded but target not found');
        return;
      }

      fs.rename(target, install, function(err) {
        if (err) {
          log.error('node-sass build', err.message);
          return;
        }

        log.info('node-sass build', 'Installed to %s', install);
      });
    });
  });
}

/**
 * manageProcess
 *
 * @param {ChildProcess} proc
 * @param {Function} cb
 * @api private
 */

function manageProcess(proc, cb) {
  var errorMsg = '';
  proc.stderr.on('data', function(data) {
    errorMsg += data.toString();
  });
  proc.on('close', function(code) {
    cb(code === 0 ? null : { message: errorMsg });
  });
}

/**
 * initSubmodules
 *
 * @param {Function} cb
 * @api private
 */

function initSubmodules(cb) {
  log.info('node-sass build', 'Detected a git install');
  log.info('node-sass build', 'Cloning LibSass into src/libsass');

  var clone = spawn('git', ['clone', 'https://github.com/sass/libsass.git', './src/libsass']);
  manageProcess(clone, function(err) {
    if (err) {
      cb(err);
      return;
    }

    log.info('node-sass build', 'Checking out LibSass to %s', pkg.libsass);

    var checkout = spawn('git', ['checkout', pkg.libsass], { cwd: './src/libsass' });
    manageProcess(checkout, function(err) {
      cb(err);
    });
  });
}

/**
 * installGitDependencies
 *
 * @param {Function} cb
 * @api private
 */

function installGitDependencies(options, cb) {
  var libsassPath = './src/libsass';

  if (process.env.LIBSASS_EXT || options.libsassExt) {
    cb();
  } else if (fs.access) { // node 0.12+, iojs 1.0.0+
    fs.access(libsassPath, fs.R_OK, function(err) {
      err && err.code === 'ENOENT' ? initSubmodules(cb) : cb();
    });
  } else { // node < 0.12
    fs.exists(libsassPath, function(exists) {
      exists ? cb() : initSubmodules(cb);
    });
  }
}

/**
 * Build
 *
 * @param {Object} options
 * @api private
 */

function build(options) {
  installGitDependencies(options, function(err) {
    if (err) {
      log.error('node-sass build', err.message);
      process.exit(1);
    }

    var args = [require.resolve(path.join('node-gyp', 'bin', 'node-gyp.js')), 'rebuild', '--verbose'].concat(
      ['libsass_ext', 'libsass_cflags', 'libsass_ldflags', 'libsass_library'].map(function(subject) {
        return ['--', subject, '=', process.env[subject.toUpperCase()] || ''].join('');
      })).concat(options.args);

    log.info('node-sass build', [process.execPath].concat(args).join(' '));

    var proc = spawn(process.execPath, args, {
      stdio: [0, 1, 2]
    });

    proc.on('exit', function(errorCode) {
      if (!errorCode) {
        afterBuild(options);
        return;
      }

      if (errorCode === 127 ) {
        log.error('node-sass build', 'node-gyp not found!');
      } else {
        log.error('node-sass build', 'Build failed with error code: %d', errorCode);
      }

      process.exit(1);
    });
  });
}

/**
 * Parse arguments
 *
 * @param {Array} args
 * @api private
 */

function parseArgs(args) {
  var options = {
    arch: process.arch,
    platform: process.platform
  };

  options.args = args.filter(function(arg) {
    if (arg === '-f' || arg === '--force') {
      options.force = true;
      return false;
    } else if (arg.substring(0, 13) === '--target_arch') {
      options.arch = arg.substring(14);
    } else if (arg === '-d' || arg === '--debug') {
      options.debug = true;
    } else if (arg.substring(0, 13) === '--libsass_ext' && arg.substring(14) !== 'no') {
      options.libsassExt = true;
    }

    return true;
  });

  return options;
}

/**
 * Test for pre-built library
 *
 * @param {Object} options
 * @api private
 */

function testBinary(options) {
  if (options.force || process.env.SASS_FORCE_BUILD) {
    return build(options);
  }

  if (!sass.hasBinary(sass.getBinaryPath())) {
    return build(options);
  }

  log.info('node-sass build', 'Binary found at %s', sass.getBinaryPath());
  log.info('node-sass build', 'Testing binary');

  try {
    require('../').renderSync({
      data: 's { a: ss }'
    });

    log.info('node-sass build', 'Binary is fine');
  } catch (e) {
    log.error('node-sass build', 'Binary has a problem: %s', e);
    log.info('node-sass build', 'Building the binary locally');

    return build(options);
  }
}

/**
 * Apply arguments and run
 */

testBinary(parseArgs(process.argv.slice(2)));
