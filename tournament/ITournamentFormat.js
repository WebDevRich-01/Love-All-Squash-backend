/**
 * Tournament Format Interface
 *
 * All tournament formats must implement this interface to ensure
 * consistent behavior and easy extensibility.
 */

class ITournamentFormat {
  constructor() {
    if (this.constructor === ITournamentFormat) {
      throw new Error('Cannot instantiate abstract class ITournamentFormat');
    }
  }

  /**
   * Unique identifier for this format
   * @returns {string}
   */
  get id() {
    throw new Error('Must implement id getter');
  }

  /**
   * Human-readable name for this format
   * @returns {string}
   */
  get name() {
    throw new Error('Must implement name getter');
  }

  /**
   * Validate tournament configuration and participants
   * @param {Object} config - Tournament configuration
   * @param {Array} participants - Array of participant objects
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  validateConfig(config, participants) {
    throw new Error('Must implement validateConfig method');
  }

  /**
   * Generate initial tournament state and matches
   * @param {Object} config - Tournament configuration
   * @param {Array} participants - Array of participant objects with seeds
   * @returns {Object} { state: Object, matches: Array, groups?: Array }
   */
  generateInitialState(config, participants) {
    throw new Error('Must implement generateInitialState method');
  }

  /**
   * Process a match result and update tournament state
   * @param {Object} state - Current tournament state
   * @param {Object} tournamentMatch - Tournament match object
   * @param {Object} matchResult - Match result from scoring system
   * @returns {Object} {
   *   state: Object,
   *   updatedMatches: Array,
   *   newMatches: Array,
   *   standingsUpdates?: Array,
   *   tournamentComplete?: boolean
   * }
   */
  onMatchResult(state, tournamentMatch, matchResult) {
    throw new Error('Must implement onMatchResult method');
  }

  /**
   * Get current standings/bracket view
   * @param {Object} state - Current tournament state
   * @param {Array} groups - Tournament groups (if applicable)
   * @returns {Object} Format-appropriate standings data
   */
  getStandings(state, groups = []) {
    throw new Error('Must implement getStandings method');
  }

  /**
   * Get matches that are ready to be played
   * @param {Object} state - Current tournament state
   * @param {Array} matches - All tournament matches
   * @returns {Array} Matches ready for play
   */
  getNextPlayableMatches(state, matches) {
    throw new Error('Must implement getNextPlayableMatches method');
  }

  /**
   * Serialize tournament state for storage
   * @param {Object} state - Tournament state to serialize
   * @returns {string} Serialized state
   */
  serialize(state) {
    return JSON.stringify(state);
  }

  /**
   * Deserialize tournament state from storage
   * @param {string} blob - Serialized state string
   * @returns {Object} Tournament state object
   */
  deserialize(blob) {
    try {
      return JSON.parse(blob);
    } catch (error) {
      throw new Error(
        `Failed to deserialize tournament state: ${error.message}`
      );
    }
  }

  /**
   * Check if tournament is complete
   * @param {Object} state - Current tournament state
   * @returns {boolean}
   */
  isComplete(state) {
    throw new Error('Must implement isComplete method');
  }

  /**
   * Get final results/placements
   * @param {Object} state - Final tournament state
   * @param {Array} groups - Tournament groups (if applicable)
   * @returns {Array} Final placements with participant details
   */
  getFinalResults(state, groups = []) {
    throw new Error('Must implement getFinalResults method');
  }
}

module.exports = ITournamentFormat;
