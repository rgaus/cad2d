/** Maps an index into a unique key combo that can be used for selection of a large number of items. */
export function mapIndexToKeyCombo(index: number) {
  return index.toString(26).split('').map((char) => {
    switch (char) {
      case '0': return 'a';
      case '1': return 'b';
      case '2': return 'c';
      case '3': return 'd';
      case '4': return 'e';
      case '5': return 'f';
      case '6': return 'g';
      case '7': return 'h';
      case '8': return 'i';
      case '9': return 'j';
      case 'a': return 'k';
      case 'b': return 'l';
      case 'c': return 'm';
      case 'd': return 'n';
      case 'e': return 'o';
      case 'f': return 'p';
      case 'g': return 'q';
      case 'h': return 'r';
      case 'i': return 's';
      case 'j': return 't';
      case 'k': return 'u';
      case 'l': return 'v';
      case 'm': return 'w';
      case 'n': return 'x';
      case 'o': return 'y';
      case 'p': return 'z';
    }
  }).join('');
}
