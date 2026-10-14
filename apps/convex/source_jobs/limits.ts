/** Cap on the Sources one SourceJob result may carry; the surplus is left to the
 * next execution (the batch cursor does not advance while work remains). */
export const MAX_SOURCES_PER_RESULT = 50;
