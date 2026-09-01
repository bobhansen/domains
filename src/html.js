import { createElement, Fragment } from 'react';
import htm from 'htm';

export const html = htm.bind(createElement);
export { Fragment };
