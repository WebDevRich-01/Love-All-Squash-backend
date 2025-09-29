const SingleEliminationFormat = require('./formats/SingleEliminationFormat');
const RoundRobinFormat = require('./formats/RoundRobinFormat');
const MonradFormat = require('./formats/MonradFormat');
const PoolsKnockoutFormat = require('./formats/PoolsKnockoutFormat');

/**
 * Tournament Engine - Manages tournament formats and operations
 */
class TournamentEngine {
  constructor() {
    this.formats = new Map();
    this._registerFormats();
  }

  /**
   * Register all available tournament formats
   * @private
   */
  _registerFormats() {
    const formats = [
      new SingleEliminationFormat(),
      new RoundRobinFormat(),
      new MonradFormat(),
      new PoolsKnockoutFormat(),
    ];

    formats.forEach((format) => {
      this.formats.set(format.id, format);
    });
  }

  /**
   * Get all available tournament formats
   * @returns {Array} Array of format objects with id and name
   */
  getAvailableFormats() {
    return Array.from(this.formats.values()).map((format) => ({
      id: format.id,
      name: format.name,
    }));
  }

  /**
   * Get a specific tournament format
   * @param {string} formatId - Format identifier
   * @returns {ITournamentFormat} Tournament format instance
   */
  getFormat(formatId) {
    const format = this.formats.get(formatId);
    if (!format) {
      throw new Error(`Unknown tournament format: ${formatId}`);
    }
    return format;
  }

  /**
   * Validate tournament configuration
   * @param {string} formatId - Tournament format ID
   * @param {Object} config - Tournament configuration
   * @param {Array} participants - Tournament participants
   * @returns {Object} Validation result
   */
  validateTournament(formatId, config, participants) {
    const format = this.getFormat(formatId);
    return format.validateConfig(config, participants);
  }

  /**
   * Generate initial tournament state
   * @param {string} formatId - Tournament format ID
   * @param {Object} config - Tournament configuration
   * @param {Array} participants - Tournament participants
   * @returns {Object} Initial tournament state and matches
   */
  generateTournament(formatId, config, participants) {
    const format = this.getFormat(formatId);

    // Validate first
    const validation = format.validateConfig(config, participants);
    if (!validation.valid) {
      throw new Error(
        `Tournament validation failed: ${validation.errors.join(', ')}`
      );
    }

    return format.generateInitialState(config, participants);
  }

  /**
   * Process a match result
   * @param {string} formatId - Tournament format ID
   * @param {Object} state - Current tournament state
   * @param {Object} tournamentMatch - Tournament match object
   * @param {Object} matchResult - Match result from scoring system
   * @param {Array} groups - Tournament groups (if applicable)
   * @returns {Object} Updated tournament state and matches
   */
  processMatchResult(
    formatId,
    state,
    tournamentMatch,
    matchResult,
    groups = []
  ) {
    const format = this.getFormat(formatId);
    return format.onMatchResult(state, tournamentMatch, matchResult, groups);
  }

  /**
   * Get current tournament standings
   * @param {string} formatId - Tournament format ID
   * @param {Object} state - Current tournament state
   * @param {Array} groups - Tournament groups (if applicable)
   * @returns {Object} Tournament standings
   */
  getStandings(formatId, state, groups = []) {
    const format = this.getFormat(formatId);
    return format.getStandings(state, groups);
  }

  /**
   * Get matches ready to be played
   * @param {string} formatId - Tournament format ID
   * @param {Object} state - Current tournament state
   * @param {Array} matches - All tournament matches
   * @returns {Array} Playable matches
   */
  getPlayableMatches(formatId, state, matches) {
    const format = this.getFormat(formatId);
    return format.getNextPlayableMatches(state, matches);
  }

  /**
   * Check if tournament is complete
   * @param {string} formatId - Tournament format ID
   * @param {Object} state - Current tournament state
   * @returns {boolean}
   */
  isTournamentComplete(formatId, state) {
    const format = this.getFormat(formatId);
    return format.isComplete(state);
  }

  /**
   * Get final tournament results
   * @param {string} formatId - Tournament format ID
   * @param {Object} state - Final tournament state
   * @param {Array} groups - Tournament groups (if applicable)
   * @returns {Array} Final results
   */
  getFinalResults(formatId, state, groups = []) {
    const format = this.getFormat(formatId);
    return format.getFinalResults(state, groups);
  }

  /**
   * Serialize tournament state
   * @param {string} formatId - Tournament format ID
   * @param {Object} state - Tournament state
   * @returns {string} Serialized state
   */
  serializeState(formatId, state) {
    const format = this.getFormat(formatId);
    return format.serialize(state);
  }

  /**
   * Deserialize tournament state
   * @param {string} formatId - Tournament format ID
   * @param {string} blob - Serialized state
   * @returns {Object} Tournament state
   */
  deserializeState(formatId, blob) {
    const format = this.getFormat(formatId);
    return format.deserialize(blob);
  }
}

module.exports = TournamentEngine;
