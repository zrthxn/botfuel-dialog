const fs = require('fs');
const dir = require('node-dir');
const Qna = require('botfuel-qna-sdk');
const Spellchecking = require('botfuel-nlp-sdk').Spellchecking;
const logger = require('logtown')('Nlu');
const Classifier = require('./classifier');
const BooleanExtractor = require('./extractors/boolean-extractor');
const CompositeExtractor = require('./extractors/composite-extractor');

/**
 * A nlu module (could be replaced by an external one).
 */
class Nlu {
  /**
   * @constructor
   * @param {Object} config - the bot config
   */
  constructor(config) {
    logger.debug('constructor', config);
    this.config = config;
    this.extractor = new CompositeExtractor(this.getExtractors(`${config.path}/src/extractors`));
    this.classifier = new Classifier(config);
    if (config.qna) {
      this.qna = new Qna({
        appId: process.env.BOTFUEL_APP_ID,
        appKey: process.env.BOTFUEL_APP_KEY,
      });
    }
    if (config.spellchecking) {
      this.spellchecking = new Spellchecking({
        appId: process.env.BOTFUEL_APP_ID,
        appKey: process.env.BOTFUEL_APP_KEY,
      });
    }
  }

  /**
   * Gets extractor files
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
   * Gets and instantiates extractors
   * @param {String} path - extractors path
   * @returns {Array.<*>} - extractors instances
   */
  getExtractors(path) {
    // user extractors
    const extractors = this.getExtractorFiles(path).map((file) => {
      const ExtractorConstructor = require(file);
      return new ExtractorConstructor(ExtractorConstructor.params);
    });
    // system extractors
    extractors.push(new BooleanExtractor({ locale: this.config.locale }));
    return extractors;
  }

  /**
   * Initializes the Nlu module
   * @returns {Promise.<void>}
   */
  async init() {
    logger.debug('init');
    await this.classifier.init();
  }

  /**
   * Classifies a sentence.
   * @param {String} sentence - the sentence
   * @returns {Promise} a promise with entities and intents
   */
  async compute(sentence) {
    logger.debug('compute', sentence);
    if (this.config.spellchecking) {
      const result = await this.spellcheck(sentence, this.config.spellchecking);
      sentence = result.correctSentence;
    }
    if (this.config.qna === 'before') {
      const result = await this.qnaCompute(sentence);
      if (result.entities[0].value.length !== 0) {
        return result;
      }
      return this.localCompute(sentence);
    } else if (this.config.qna === 'after') {
      const result = await this.localCompute(sentence);
      if (result.intents.length !== 0) {
        return result;
      }
      return this.qnaCompute(sentence);
    }
    return this.localCompute(sentence);
  }

  /**
   * Computes local bot intents and entities
   * @param {String} sentence - the user sentence
   * @returns {Promise.<Object>}
   */
  async localCompute(sentence) {
    logger.debug('localCompute', sentence);
    const entities = await this.extractor.compute(sentence);
    logger.debug('localCompute: entities', entities);
    const intents = await this.classifier.compute(sentence, entities);
    logger.debug('localCompute: intents', intents);
    return { intents, entities };
  }

  /**
   * Computes qnas intents and entities
   * @param {String} sentence - the user sentence
   * @returns {Promise.<Object>}
   */
  async qnaCompute(sentence) {
    logger.debug('qnaCompute', sentence);
    const qnas = await this.qna.getMatchingQnas({ sentence });
    logger.debug('compute: qnas', qnas);
    const intents = [
      {
        label: 'qnas_dialog',
        value: 1.0,
      },
    ];
    const entities = [
      {
        dim: 'qnas',
        value: qnas,
      },
    ];
    return { intents, entities };
  }

    /**
   * Spellchecks a sentence.
   * @param {String} sentence - a sentence
   * @param {String} key - a dictionary key
   * @returns {Object} the spellchecking result
   */
  async spellcheck(sentence, key) {
    logger.debug('spellcheck', sentence, key);
    const result = await this.spellchecking.compute({ sentence, key });
    logger.debug('spellcheck: result', result);
    return result;
  }
}

module.exports = Nlu;
