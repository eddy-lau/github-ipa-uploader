/* jslint esversion: 6, node: true */
'use strict';

var path = require('path');
var fs = require('fs');
var ipaMetadata = require('ipa-metadata2');
var publishRelease = require('publish-release');
const _cliProgress = require('cli-progress');


function getIPAMetadata(ipaFilePath) {

  return new Promise( (resolve, reject) => {

    ipaMetadata(ipaFilePath, (error, data) => {
      if (error) {
        reject(error);
      } else {
        resolve(data);
      }
    });

  });

}

function publishToGithub(opts, assets) {

  return new Promise( (resolve, reject) => {

    var publisher = publishRelease({
      token: opts.token,
      owner: opts.owner,
      repo: opts.repo,
      tag: opts.tag,
      name: undefined,
      notes: undefined,
      draft: false,
      prerelease: false,
      reuseRelease: true,
      reuseDraftOnly: true,
      skipAssetsCheck: false,
      skipDuplicatedAssets: false,
      skipIfPublished: false,
      editRelease: false,
      deleteEmptyTag: false,
      assets: assets,
      //apiUrl: 'https://myGHEserver/api/v3',
      //target_commitish: 'master'
    }, function (err, release) {
      // `release`: object returned from github about the newly created release
      if (err) {
        reject(err);
      } else {
        resolve(release);
      }
    });

    var progressBar;
    publisher.on('upload-asset', filename => {
      if (progressBar) {
        progressBar.stop();
        progressBar = undefined;
      }
    });

    publisher.on('upload-progress', (filename, progress) => {

      if (!progressBar) {
        progressBar = new _cliProgress.Bar({
          format: 'Uploading ' + filename + ' [{bar}] {percentage}% | ETA: {eta}s | {value}/{total}'
        }, _cliProgress.Presets.shades_classic);
        progressBar.start(progress.length, 0);
      }

      progressBar.update(progress.transferred);

    });

  });
}

function buildManifest(opts, metadata, ipaFileName, iconURL) {

  var version = metadata.CFBundleShortVersionString;
  var buildNumber = metadata.CFBundleVersion;
  var bundileIdentifier = metadata.CFBundleIdentifier;
  var appName = metadata.CFBundleDisplayName;

  var plist = fs.readFileSync(path.join(__dirname, 'manifest_template.plist'), 'utf8');

  plist = plist.replace(/{{ owner }}/g, opts.owner);
  plist = plist.replace(/{{ repo }}/g, opts.repo);
  plist = plist.replace(/{{ tag }}/g, opts.tag);
  plist = plist.replace(/{{ ipaFileName }}/g, ipaFileName);
  plist = plist.replace(/{{ bundileIdentifier }}/g, bundileIdentifier);
  plist = plist.replace(/{{ version }}/g, version);
  plist = plist.replace(/{{ buildNumber }}/g, buildNumber);
  plist = plist.replace(/{{ appName }}/g, appName);
  plist = plist.replace(/{{ iconURL }}/g, iconURL);

  return new Promise( (resolve, reject) => {
    var baseFilename = ipaFileName.slice(0, -4);
    var outputFileName = baseFilename + '.plist';
    var manifestPath = path.join(__dirname, outputFileName);
    fs.writeFile(manifestPath, plist, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve(manifestPath);
      }
    });
  });

}

function getAssets(opts) {

  var promises = [];

  opts.binaries.forEach( binary => {

    promises.push( Promise.resolve(binary.path) );

    if (path.basename(binary.path).toLowerCase().endsWith('.ipa')) {

      var promise =
        getIPAMetadata( binary.path )
        .then( data => {

          opts.version = opts.version || data.metadata.CFBundleShortVersionString;
          opts.buildNumber = opts.buildNumber || data.metadata.CFBundleVersion;
          var binaryFileName = path.basename(binary.path);
          opts.tag = opts.tag || [opts.tagPrefix, opts.version, opts.buildNumber].join('_');
          return buildManifest(opts, data.metadata, binaryFileName, binary.iconURL);

        });

      promises.push(promise);

    }

  });

  return Promise.all(promises);

}

function main(options) {

  var opts = Object.assign({}, options);

  var assets;
  return getAssets(opts)
  .then( result => {

    assets = result;
    return publishToGithub(opts, assets);

  }).then( release => {

    var plist;
    assets.filter( asset => {
      return asset.endsWith('.plist');
    }).forEach( asset => {
      plist = path.basename(asset);
      fs.unlinkSync(asset);
    });

    return {
      version: opts.version,
      buildNumber: opts.buildNumber,
      plist: plist,
      release: release
    };

  });

}

module.exports = {
  upload: main
};
