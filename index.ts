import { startAssistant } from './assistant';
import { syncScriptMetadata } from './script-metadata';

$(() => {
  errorCatched(startAssistant)();
  syncScriptMetadata();
});
