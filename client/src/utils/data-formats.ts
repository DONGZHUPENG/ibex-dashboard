import * as _ from 'lodash';
import { IDataSourcePlugin } from '../data-sources/plugins/DataSourcePlugin';

export enum DataFormatTypes {
  none,
  timespan,
  flags,
  retention,
  timeline
}

export interface IDataFormat {
  type: DataFormatTypes
  args: any
}

export function timespan(format, state, dependencies, plugin: IDataSourcePlugin) {

  if (!state) { return null; }

  let queryTimespan =
    state.selectedValue === '24 hours' ? 'PT24H' :
    state.selectedValue === '1 week' ? 'P7D' :
    state.selectedValue === '1 month' ? 'P30D' :
    'P90D';

  let granularity =
    state.selectedValue === '24 hours' ? '5m' :
    state.selectedValue === '1 week' ? '1d' : '1d';

  return { queryTimespan, granularity };
}

export function flags(format, state, dependencies, plugin: IDataSourcePlugin) {

  const params = plugin.getParams();

  if (!state || !params || !Array.isArray(params.values)) { return null; }

  let flags = {};
  params.values.forEach(key => { flags[key] = state.selectedValue === key; });
  return flags;
}

export function scorecard (format, state, dependencies, plugin: IDataSourcePlugin) {
  let { values } = state;

  let createScoreValue = (value: any, color: string, icon: string) => {
    let item = {};
    let prefix = format.args && format.args.prefix || plugin._props.id;
    item[prefix + '_value'] = value;
    item[prefix + '_color'] = color;
    item[prefix + '_icon'] = icon;
    return item;
  };

  let args = format && format.args || { thresholds: null };
  let thresholds = args.thresholds || [ ];
  let firstThreshold = thresholds.length && thresholds[0] || { value: 0, color: '#000', icon: 'done' };
  let countField = args.countField || 'count';

  if (!values || !values.length) { 
    return createScoreValue(firstThreshold.value, firstThreshold.color, firstThreshold.icon);
  }

  // Todo: check validity of thresholds and each value

  let checkValue = values[0][countField];
  let thresholdIdx = 0;
  let threshold = thresholds[thresholdIdx++];
  
  while (checkValue > threshold.value && thresholds.length > thresholdIdx) {
    threshold = thresholds[thresholdIdx++];      
  }

  return createScoreValue(checkValue, threshold.color, threshold.icon);
}

/**
 * Received a result in the form of:
 * values: [
 *  {
 *    totalUnique: number
 *    totalUniqueUsersIn24hr: number
 *    totalUniqueUsersIn7d: number
 *    totalUniqueUsersIn30d: number
 *    returning24hr: number
 *    returning7d: number
 *    returning30d: number
 *  }
 * ]
 *
 * And returns the following format:
 * {
 *  total: number
 *  returning: number
 *  values: [
 *    { 
 *      timespan: '24 hours', 
 *      retention: '%',
 *      returning: number,
 *      unique:number 
 *    },
 *    { 
 *      timespan: '7 days', 
 *      retention: '%',
 *      returning: number,
 *      unique:number 
 *    }
 *    { 
 *      timespan: '30 days', 
 *      retention: '%',
 *      returning: number,
 *      unique:number 
 *    }
 *  ]
 * }
 * 
 * @param format Plugin format parameter
 * @param state Current received state from data source
 * @param dependencies Dependencies for the plugin
 * @param plugin The entire plugin (for id generation, params etc...)
 */
export function retention (format, state, dependencies, plugin: IDataSourcePlugin) {
  const { values } = state;
  const { selectedTimespan } = dependencies;

  let result = {
    totalUnique: 0,
    totalUniqueUsersIn24hr: 0,
    totalUniqueUsersIn7d: 0,
    totalUniqueUsersIn30d: 0,
    returning24hr: 0,
    returning7d: 0,
    returning30d: 0,

    total: 0,
    returning: 0,
    values: []
  };

  if (values && values.length) {
    _.extend(result, values[0]);
  }

  switch (selectedTimespan) {
    case 'PT24H':
      result.total = result.totalUniqueUsersIn24hr;
      result.returning = result.returning24hr;
      break;

    case 'P7D':
      result.total = result.totalUniqueUsersIn7d;
      result.returning = result.returning7d;
      break;

    case 'P30D':
      result.total = result.totalUniqueUsersIn30d;
      result.returning = result.returning30d;
      break;
  }

  result.values = [
    { 
      timespan: '24 hours', 
      retention: Math.round(100 * result.returning24hr / result.totalUniqueUsersIn24hr || 0) + '%',
      returning: result.returning24hr,
      unique: result.totalUniqueUsersIn24hr 
    },
    { 
      timespan: '7 days', 
      retention: Math.round(100 * result.returning7d / result.totalUniqueUsersIn7d || 0) + '%',
      returning: result.returning7d,
      unique: result.totalUniqueUsersIn7d
    },
    { 
      timespan: '30 days', 
      retention: Math.round(100 * result.returning30d / result.totalUniqueUsersIn30d || 0) + '%',
      returning: result.returning30d,
      unique: result.totalUniqueUsersIn30d
    },
  ];

  return result;
}

/**
 * Formats a result to fit a filter.
 * 
 * Receives a list of filtering values:
 * values: [
 *  { field: 'value 1' },
 *  { field: 'value 2' },
 *  { field: 'value 3' },
 * ]
 * 
 * And outputs the result in a consumable filter way:
 * result: {
 *  "prefix-filters": [ 'value 1', 'value 2', 'value 3' ],
 *  "prefix-selected": [ ],
 * }
 * 
 * "prefix-selected" will be able to hold the selected values from the filter component
 * 
 * @param format { 
 *  type: 'filter',
 *  args: { 
 *    prefix: string - The prefix of the variable to be consumed, 
 *    field: string - the field holding the filter values in the results
 *  }
 * }
 * @param state Current received state from data source
 * @param dependencies Dependencies for the plugin
 * @param plugin The entire plugin (for id generation, params etc...)
 * @param prevState The previous state to compare for changing filters
 */
export function filter (
  format: string | IDataFormat, 
  state: any, 
  dependencies: IDictionary, 
  plugin: IDataSourcePlugin, 
  prevState: any) {

  const { values } = state;

  let filterValues = values;
  if (!filterValues || typeof format === 'string' || !format.args.prefix) { return {}; }

  const { prefix, field } = format.args;
  const unknown = format.args.unknown || 'unknown';

  // This code is meant to fix the following scenario:
  // When "Timespan" filter changes, to "channels-selected" variable
  // is going to be reset into an empty set.
  // For this reason, using previous state to copy filter
  const filters = filterValues.map(x => x[field] || unknown);
  let selectedValues = [];
  if (prevState[prefix + '-selected'] !== undefined) {
    selectedValues = prevState[prefix + '-selected'];
  }

  let result = {};
  result[prefix + '-filters'] = filters;
  result[prefix + '-selected'] = selectedValues;

  return result;
}

/**
 * Formats a result to suite a timeline (time series) chart
 * 
 * Receives a list of filtering values:
 * values: [
 *  { field: 'value 1' },
 *  { field: 'value 2' },
 *  { field: 'value 3' },
 * ]
 * 
 * And outputs the result in a consumable filter way:
 * result: {
 *  "prefix-filters": [ 'value 1', 'value 2', 'value 3' ],
 *  "prefix-selected": [ ],
 * }
 * 
 * "prefix-selected" will be able to hold the selected values from the filter component
 * 
 * @param format { 
 *  type: 'filter',
 *  args: { 
 *    timeField: 'timestamp' - The field containing timestamp
 *    lineField: 'channel' - A field to hold/group by different lines in the graph
 *    valueField: 'count' - holds the value/y value of the current point
 *  }
 * }
 * @param state Current received state from data source
 * @param dependencies Dependencies for the plugin
 * @param plugin The entire plugin (for id generation, params etc...)
 * @param prevState The previous state to compare for changing filters
 */
export function timeline(
  format: string | IDataFormat, 
  state: any, 
  dependencies: IDictionary, 
  plugin: IDataSourcePlugin, 
  prevState: any) {

  if (typeof format === 'string') { return {}; }

  const timeline = state.values;
  const { timespan } = dependencies;
  const { timeField, lineField, valueField } = format.args;

  let _timeline = {};
  let _lines = {};

  timeline.forEach(row => {
    let timestamp = row[timeField];
    let lineFieldValue = row[lineField];
    let valueFieldValue = row[valueField];

    var timeValue = (new Date(timestamp)).getTime();

    if (!_timeline[timeValue]) _timeline[timeValue] = {
      time: (new Date(timestamp)).toUTCString()
    };
    if (!_lines[lineFieldValue]) _lines[lineFieldValue] = {
      name: lineFieldValue,
      value: 0
    };

    _timeline[timeValue][lineFieldValue] = valueFieldValue;
    _lines[lineFieldValue].value += valueFieldValue;
  });

  let lines = Object.keys(_lines);
  let usage = _.values(_lines);
  let timelineValues = _.map(_timeline, value => {
    lines.forEach(line => {
      if (!value[line]) value[line] = 0;
    });
    return value;
  });

  return {
    "timeline-graphData": timelineValues,
    "timeline-usage": usage,
    "timeline-timeFormat": (timespan === "24 hours" ? 'hour' : 'date'),
    "timeline-lines": lines
  };
}