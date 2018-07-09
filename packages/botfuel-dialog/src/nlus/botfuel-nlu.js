/**
 * Copyright (c) 2017 - present, Botfuel (https://www.botfuel.io).
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const fs = require('fs');
const fsExtra = require('fs-extra');
const rp = require('request-promise-native');
const dir = require('node-dir');
const logger = require('logtown')('BotfuelNlu');
const BooleanExtractor = require('../extractors/boolean-extractor');
const LocationExtractor = require('../extractors/location-extractor');
const CompositeExtractor = require('../extractors/composite-extractor');
const SdkError = require('../errors/sdk-error');
const ClassificationResult = require('./classification-result');
const Nlu = require('./nlu');

/**
 * NLU using Botfuel Trainer API
 */
class BotfuelNlu extends Nlu {
  /** @inheritdoc */
  constructor(config) {
    logger.debug('constructor', config);
    super(config);
    this.extractor = null;

    if (!process.env.BOTFUEL_APP_TOKEN) {
      throw new SdkError('BOTFUEL_APP_TOKEN is required for using the nlu service');
    }

    if (!process.env.BOTFUEL_APP_ID) {
      throw new SdkError('BOTFUEL_APP_ID is required for using the nlu service');
    }

    if (!process.env.BOTFUEL_APP_KEY) {
      throw new SdkError('BOTFUEL_APP_KEY is required for using the nlu service');
    }

    if (this.config) {
      const classificationFilterPath = `${this.config.path}/src/classification-filter.js`;
      if (fsExtra.pathExistsSync(classificationFilterPath)) {
        this.classificationFilter = require(classificationFilterPath);
      }
    }
  }

  /**
   * Gets extractor files.
   * @param {String} path - extractors path
   * @returns {Array.<string>} - extractor files
   */
  getExtractorFiles(path) {
    let files = [];
    if (fs.existsSync(path)) {
      files = dir.files(path, { sync: true }) || files;
    }
    return files.filter(file => file.match(/^.*.js$/));
  }

  /**
   * Gets extractors.
   * @param {String} path - extractors path
   * @returns {Array.<*>} - extractor instances
   */
  getExtractors(path) {
    // user extractors
    const extractors = this.getExtractorFiles(path).map((file) => {
      const ExtractorConstructor = require(file);
      return new ExtractorConstructor(ExtractorConstructor.params);
    });
    // system extractors
    extractors.push(new BooleanExtractor({ locale: this.config.locale }));
    extractors.push(new LocationExtractor({}));
    return extractors;
  }

  /** @inheritdoc */
  async init() {
    logger.debug('init');
    super.init();

    // Extractors
    this.extractor = new CompositeExtractor({
      extractors: this.getExtractors(`${this.config.path}/src/extractors`),
    });
  }

  /** @inheritdoc */
  async compute(sentence, context) {
    logger.debug('compute', sentence); // Context is not loggable

    // compute entities
    const messageEntities = await this.computeEntities(sentence);

    // compute intents
    let trainerUrl = process.env.BOTFUEL_TRAINER_API_URL || 'https://api.botfuel.io/trainer/api/v0';

    if (trainerUrl.slice(-1) !== '/') {
      trainerUrl += '/';
    }

    const options = {
      uri: `${trainerUrl}classify`,
      qs: {
        sentence,
      },
      headers: {
        'Botfuel-Bot-Id': process.env.BOTFUEL_APP_TOKEN,
        'App-Id': process.env.BOTFUEL_APP_ID,
        'App-Key': process.env.BOTFUEL_APP_KEY,
      },
      json: true,
    };

    const res = await rp(options);

    let classificationResults = res.map(data => new ClassificationResult(data));
    if (this.classificationFilter) {
      classificationResults = await this.classificationFilter(classificationResults, context);
      classificationResults = classificationResults.slice(0, this.config.multiIntent ? 2 : 1);
    }
    return { messageEntities, classificationResults };
  }

  /**
   * Computes entities using the classifier.
   * @param {String} sentence - the user sentence
   * @returns {Object} entities
   */
  async computeEntities(sentence) {
    logger.debug('computeEntities', sentence);
    const entities = await this.extractor.compute(sentence);
    return entities;
  }
}

module.exports = BotfuelNlu;
