'use strict';

const errors = require('./errors');
const filterFiles = require('./utils/filter-files');
const getCompositeDetails = require('./utils/get-composite-details');
const getFileDetails = require('./utils/get-file-details');
const getStringDetails = require('./utils/get-string-details');
const constants = require('./constants');

/**
 * @typedef {Object} ManifestEntry
 * @property {String} url The URL to the asset in the manifest.
 * @property {String} revision The revision details for the file. This is a
 * hash generated by node based on the file contents.
 * @memberof module:workbox-build
 */


/**
 * To get a list of files and revision details that can be used to ultimately
 * precache assets in a service worker.
 *
 * @param {Object} input
 * @param {String} input.globDirectory The directory you wish to run the
 * `globPatterns` against.
 * @param {Array<String>} input.globPatterns Files matching against any of
 * these glob patterns will be included in the file manifest.
 * @param {String|Array<String>} [input.globIgnores] Files matching against any
 * of these glob patterns will be excluded from the file manifest, even if the
 * file matches against a `globPatterns` pattern. Defaults to ignoring
 * 'node_modules'.
 * @param {Object<String,Array|String>} [input.templatedUrls]
 * If a URL is rendered with templates on the server, its contents may
 * depend on multiple files. This maps URLs to an array of file names, or to a
 * string value, that uniquely determines the URL's contents.
 * @param {String} [input.modifyUrlPrefix] An object of key value pairs
 * where URL's starting with the key value will be replaced with the
 * corresponding value.
 * @param {number} [input.maximumFileSizeToCacheInBytes] This value can be used
 * to determine the maximum size of files that will be precached.
 *
 * Defaults to 2MB.
 * @param {RegExp} [input.dontCacheBustUrlsMatching] An optional regex that will
 * return a URL string and exclude the revision details for urls matching this
 * regex. Useful if you have assets with file revisions in the URL.
 * @param {Array<ManifestTransform>} [input.manifestTransforms] A list of
 * manifest transformations, which will be applied sequentially against the
 * generated manifest. If `modifyUrlPrefix` or `dontCacheBustUrlsMatching` are
 * also specified, their corresponding transformations will be applied first.
 * @return {Promise<Array<ManifestEntry>>}
 * An array of {@link module:workbox-build#ManifestEntry|ManifestEntries}
 * which will include a url and revision parameter.
 * @memberof module:workbox-build
 */
const getFileManifestEntries = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return Promise.reject(
      new Error(errors['invalid-get-manifest-entries-input']));
  }

  // staticFileGlobs is to ease workbox to sw-precache migration.
  if (input.globPatterns && input.staticFileGlobs) {
    return Promise.reject(
      new Error(errors['both-glob-patterns-static-file-globs']));
  }

  let globPatterns = input.globPatterns || input.staticFileGlobs;
  if (typeof input.globPatterns === 'undefined' &&
    typeof input.staticFileGlobs === 'undefined') {
    globPatterns = constants.defaultGlobPatterns;
  }

  const globIgnores = input.globIgnores || constants.defaultGlobIgnores;
  const globDirectory = input.globDirectory;

  // dynamicUrlToDependencies is to ease workbox to sw-precache migration.
  if (input.templatedUrls && input.dynamicUrlToDependencies) {
    return Promise.reject(
      new Error(errors['both-templated-urls-dynamic-urls']));
  }
  const templatedUrls = input.templatedUrls || input.dynamicUrlToDependencies;

  if (typeof globDirectory !== 'string' || globDirectory.length === 0) {
    return Promise.reject(
      new Error(errors['invalid-glob-directory']));
  }

  if (!globPatterns || !Array.isArray(globPatterns)) {
    return Promise.reject(
      new Error(errors['invalid-static-file-globs']));
  }

  if (!globIgnores || !Array.isArray(globIgnores)) {
    return Promise.reject(
      new Error(errors['invalid-glob-ignores']));
  }

  // templatedUrls is optional.
  if (templatedUrls && (
      typeof templatedUrls !== 'object' || Array.isArray(templatedUrls))) {
      return Promise.reject(new Error(errors['invalid-templated-urls']));
  }

  let validIgnores = true;
  globIgnores.forEach((pattern) => {
    if (typeof pattern !== 'string') {
      validIgnores = false;
    }
  });
  if (!validIgnores) {
    return Promise.reject(
      new Error(errors['invalid-glob-ignores']));
  }

  const fileSet = new Set();

  const fileDetails = globPatterns.reduce((accumulated, globPattern) => {
    const globbedFileDetails = getFileDetails(
      globDirectory, globPattern, globIgnores);
    globbedFileDetails.forEach((fileDetails) => {
      if (fileSet.has(fileDetails.file)) {
        return;
      }

      fileSet.add(fileDetails.file);
      accumulated.push(fileDetails);
    });
    return accumulated;
  }, []);

  // templatedUrls is optional.
  if (templatedUrls) {
    for (let url of Object.keys(templatedUrls)) {
      if (fileSet.has(url)) {
        return Promise.reject(
          new Error(errors['templated-url-matches-glob']));
      }

      const dependencies = templatedUrls[url];
      if (Array.isArray(dependencies)) {
        try {
          const dependencyDetails = dependencies.reduce((previous, pattern) => {
            try {
              const globbedFileDetails = getFileDetails(
                globDirectory, pattern, globIgnores);
              return previous.concat(globbedFileDetails);
            } catch (err) {
              const debugObj = {};
              debugObj[url] = dependencies;
              throw new Error(`${errors['bad-template-urls-asset']} ` +
                  `'${pattern}' in templateUrl '${JSON.stringify(debugObj)}' ` +
                  `could not be found.`);
            }
          }, []);
          fileDetails.push(getCompositeDetails(url, dependencyDetails));
        } catch (err) {
          return Promise.reject(err);
        }
      } else if (typeof dependencies === 'string') {
        fileDetails.push(getStringDetails(url, dependencies));
      } else {
        return Promise.reject(
          new Error(errors['invalid-templated-urls']));
      }
    }
  }

  return Promise.resolve(filterFiles(fileDetails, input));
};

module.exports = getFileManifestEntries;
