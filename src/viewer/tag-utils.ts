// Parse tagcount metatag from search query
// Supports: tagcount:2 (exact), tagcount:1,3 (list), tagcount:>5 (gt), tagcount:<3 (lt), tagcount:1..10 (range)
export interface TagCountFilter {
  operator: '=' | '>' | '<' | '>=' | '<=' | 'range' | 'list';
  value?: number;
  values?: number[];
  min?: number;
  max?: number;
}

// Parse Danbooru-style tag search
// Supports: tags (AND), tag1 or tag2 (OR), -tag (exclude), rating:, is:, tagcount:, account:
export interface ParsedTagSearch {
  includeTags: string[];       // Tags to include (AND)
  excludeTags: string[];       // Tags to exclude
  orGroups: string[][];        // OR groups: [[tag1, tag2], [tag3, tag4]]
  ratings: Set<string>;        // Rating filters: g, s, q, e
  fileTypes: Set<string>;      // File type filters: jpg, png, webp, gif
  tagCount: TagCountFilter | null;  // Tag count filter
  includeUnrated: boolean;     // is:unrated flag
  accounts: Set<string>;       // Account filters (X/Twitter accounts)
  excludeAccounts: Set<string>; // Excluded accounts
}

export function parseTagSearch(query: string): ParsedTagSearch {
  const result: ParsedTagSearch = {
    includeTags: [],
    excludeTags: [],
    orGroups: [],
    ratings: new Set(),
    fileTypes: new Set(),
    tagCount: null,
    includeUnrated: false,
    accounts: new Set(),
    excludeAccounts: new Set(),
  };

  if (!query.trim()) {
    return result;
  }

  let remainingQuery = query;

  // 1. Extract tagcount: metatag
  const tagCountListRegex = /tagcount:(\d+(?:,\d+)+)/gi;
  const tagCountListMatch = remainingQuery.match(tagCountListRegex);
  if (tagCountListMatch) {
    const values = tagCountListMatch[0].substring(9).split(',').map(v => parseInt(v.trim(), 10));
    result.tagCount = { operator: 'list', values };
    remainingQuery = remainingQuery.replace(tagCountListRegex, '').trim();
  } else {
    const tagCountRegex = /tagcount:(>=|<=|>|<|)(\d+)(\.\.(\d+))?/gi;
    const tagCountMatch = remainingQuery.match(tagCountRegex);
    if (tagCountMatch) {
      const match = tagCountRegex.exec(query);
      if (match) {
        const operator = match[1];
        const firstNum = parseInt(match[2], 10);
        const secondNum = match[4] ? parseInt(match[4], 10) : undefined;

        if (secondNum !== undefined) {
          result.tagCount = {
            operator: 'range',
            min: Math.min(firstNum, secondNum),
            max: Math.max(firstNum, secondNum),
          };
        } else if (operator === '>') {
          result.tagCount = { operator: '>', value: firstNum };
        } else if (operator === '<') {
          result.tagCount = { operator: '<', value: firstNum };
        } else if (operator === '>=') {
          result.tagCount = { operator: '>=', value: firstNum };
        } else if (operator === '<=') {
          result.tagCount = { operator: '<=', value: firstNum };
        } else {
          result.tagCount = { operator: '=', value: firstNum };
        }
      }
      remainingQuery = remainingQuery.replace(tagCountRegex, '').trim();
    }
  }

  // 2. Extract rating: metatags (match comma-separated list first, then single values)
  const ratingRegex = /rating:([gsqe](?:,[gsqe])+|general|sensitive|questionable|explicit|[gsqe])/gi;
  const ratingMatches = remainingQuery.match(ratingRegex);
  if (ratingMatches) {
    ratingMatches.forEach(match => {
      const value = match.substring(7).toLowerCase(); // Remove "rating:"
      if (value.includes(',')) {
        value.split(',').forEach(r => result.ratings.add(r.trim().charAt(0))); // First char only (g/s/q/e)
      } else {
        result.ratings.add(value.charAt(0)); // First char only
      }
    });
    remainingQuery = remainingQuery.replace(ratingRegex, '').trim();
  }

  // 3. Extract is: metatags
  const isRegex = /is:(unrated|jpg|jpeg|png|webp|gif|svg)/gi;
  const isMatches = remainingQuery.match(isRegex);
  if (isMatches) {
    isMatches.forEach(match => {
      const value = match.substring(3).toLowerCase(); // Remove "is:"
      if (value === 'unrated') {
        result.includeUnrated = true;
      } else if (value === 'jpeg') {
        result.fileTypes.add('image/jpeg');
      } else if (value === 'jpg') {
        result.fileTypes.add('image/jpeg');
      } else if (value === 'png') {
        result.fileTypes.add('image/png');
      } else if (value === 'webp') {
        result.fileTypes.add('image/webp');
      } else if (value === 'gif') {
        result.fileTypes.add('image/gif');
      } else if (value === 'svg') {
        result.fileTypes.add('image/svg+xml');
      }
    });
    remainingQuery = remainingQuery.replace(isRegex, '').trim();
  }

  // 4. Extract account: metatags (support comma-separated list and exclusions)
  const accountRegex = /-?account:([a-zA-Z0-9_]+(?:,[a-zA-Z0-9_]+)*)/gi;
  const accountMatches = remainingQuery.match(accountRegex);
  if (accountMatches) {
    accountMatches.forEach(match => {
      const isExclusion = match.startsWith('-');
      const value = match.substring(isExclusion ? 9 : 8); // Remove "-account:" or "account:"
      if (value.includes(',')) {
        // Multiple accounts
        value.split(',').forEach(acc => {
          const trimmed = acc.trim();
          if (trimmed) {
            if (isExclusion) {
              result.excludeAccounts.add(trimmed);
            } else {
              result.accounts.add(trimmed);
            }
          }
        });
      } else {
        // Single account
        if (value) {
          if (isExclusion) {
            result.excludeAccounts.add(value);
          } else {
            result.accounts.add(value);
          }
        }
      }
    });
    remainingQuery = remainingQuery.replace(accountRegex, '').trim();
  }

  // 5. Parse tag terms (handle OR, exclusion, regular tags)
  // Split by spaces but respect "or" as operator
  const tokens = remainingQuery.split(/\s+/).filter(t => t.length > 0);

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];

    if (token.toLowerCase() === 'or') {
      // Handle OR: take previous tag and next tag as OR group
      if (i > 0 && i < tokens.length - 1) {
        const prevTag = tokens[i - 1];
        const nextTag = tokens[i + 1];

        // Remove previous tag from includeTags if it was just added
        const prevIndex = result.includeTags.indexOf(prevTag);
        if (prevIndex !== -1) {
          result.includeTags.splice(prevIndex, 1);
        }

        // Check if previous tag is already in an OR group
        let foundGroup = false;
        for (const group of result.orGroups) {
          if (group.includes(prevTag)) {
            group.push(nextTag);
            foundGroup = true;
            break;
          }
        }

        if (!foundGroup) {
          result.orGroups.push([prevTag, nextTag]);
        }

        i += 2; // Skip 'or' and next tag
        continue;
      }
    } else if (token.startsWith('-')) {
      // Exclusion
      const tag = token.substring(1);
      if (tag) {
        result.excludeTags.push(tag);
      }
    } else {
      // Regular tag (include, AND)
      result.includeTags.push(token);
    }

    i++;
  }

  return result;
}
