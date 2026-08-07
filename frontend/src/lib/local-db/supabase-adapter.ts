import 'server-only';

import { getLocalAppDatabase } from './db';

type QueryOperation = 'select' | 'insert' | 'upsert' | 'update' | 'delete';
type Row = Record<string, unknown>;

interface QueryResult {
  data: Row[] | Row | null;
  error: { message: string; code?: string; details?: string } | null;
  count: number | null;
  status: number;
  statusText: string;
}

interface Filter {
  column: string;
  operator: 'eq' | 'neq' | 'in' | 'is' | 'not_is' | 'lte' | 'gte' | 'lt' | 'gt';
  value: unknown;
}

interface Order {
  column: string;
  ascending: boolean;
  nullsFirst?: boolean;
}

interface RelationSelection {
  alias: string;
  table: string;
  columns: string[];
}

function identifier(value: string) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw new Error(`Unsafe database identifier: ${value}`);
  }
  return `"${value}"`;
}

function splitTopLevel(value: string) {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1;
    else if (value[index] === ')') depth -= 1;
    else if (value[index] === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function parseSelection(value: string) {
  if (!value.trim() || value.trim() === '*') {
    return { scalarColumns: ['*'], relations: [] as RelationSelection[] };
  }
  const scalarColumns: string[] = [];
  const relations: RelationSelection[] = [];
  for (const part of splitTopLevel(value)) {
    const relation = part.match(/^([a-z_][a-z0-9_]*):([a-z_][a-z0-9_]*)\((.*)\)$/i);
    if (relation) {
      relations.push({
        alias: relation[1],
        table: relation[2],
        columns: splitTopLevel(relation[3]),
      });
    } else {
      scalarColumns.push(part);
    }
  }
  return { scalarColumns, relations };
}

function errorResult(error: unknown): QueryResult {
  const normalized = error as {
    message?: string;
    code?: string;
    detail?: string;
  };
  return {
    data: null,
    error: {
      message: normalized?.message ?? 'Local database query failed.',
      code: normalized?.code,
      details: normalized?.detail,
    },
    count: null,
    status: 500,
    statusText: 'Database Error',
  };
}

export class LocalSupabaseQueryBuilder
  implements PromiseLike<QueryResult>
{
  private operation: QueryOperation = 'select';
  private payload: Row | Row[] | null = null;
  private selection = '*';
  private selectionRequested = false;
  private filters: Filter[] = [];
  private orFilters: string[] = [];
  private orders: Order[] = [];
  private rowLimit: number | null = null;
  private rowOffset = 0;
  private countMode: 'exact' | null = null;
  private head = false;
  private singleMode: 'single' | 'maybe' | null = null;
  private conflictColumns: string[] = [];
  private execution: Promise<QueryResult> | null = null;

  constructor(private readonly tableName: string) {
    identifier(tableName);
  }

  select(
    columns = '*',
    options?: { count?: 'exact'; head?: boolean },
  ) {
    if (this.operation === 'select') this.operation = 'select';
    else this.selectionRequested = true;
    this.selection = columns || '*';
    this.countMode = options?.count ?? null;
    this.head = options?.head ?? false;
    return this;
  }

  insert(payload: Row | Row[]) {
    this.operation = 'insert';
    this.payload = payload;
    return this;
  }

  upsert(payload: Row | Row[], options?: { onConflict?: string }) {
    this.operation = 'upsert';
    this.payload = payload;
    this.conflictColumns = (options?.onConflict ?? 'id')
      .split(',')
      .map((column) => column.trim())
      .filter(Boolean);
    this.conflictColumns.forEach(identifier);
    return this;
  }

  update(payload: Row) {
    this.operation = 'update';
    this.payload = payload;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  eq(column: string, value: unknown) {
    return this.addFilter(column, 'eq', value);
  }

  neq(column: string, value: unknown) {
    return this.addFilter(column, 'neq', value);
  }

  in(column: string, values: unknown[]) {
    return this.addFilter(column, 'in', values);
  }

  is(column: string, value: unknown) {
    return this.addFilter(column, 'is', value);
  }

  not(column: string, operator: string, value: unknown) {
    if (operator !== 'is') throw new Error(`Unsupported local not operator: ${operator}`);
    return this.addFilter(column, 'not_is', value);
  }

  lte(column: string, value: unknown) {
    return this.addFilter(column, 'lte', value);
  }

  gte(column: string, value: unknown) {
    return this.addFilter(column, 'gte', value);
  }

  lt(column: string, value: unknown) {
    return this.addFilter(column, 'lt', value);
  }

  gt(column: string, value: unknown) {
    return this.addFilter(column, 'gt', value);
  }

  or(expression: string) {
    this.orFilters.push(expression);
    return this;
  }

  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ) {
    identifier(column);
    this.orders.push({
      column,
      ascending: options?.ascending ?? true,
      nullsFirst: options?.nullsFirst,
    });
    return this;
  }

  limit(value: number) {
    this.rowLimit = Math.max(0, Math.floor(value));
    return this;
  }

  range(from: number, to: number) {
    this.rowOffset = Math.max(0, Math.floor(from));
    this.rowLimit = Math.max(0, Math.floor(to) - this.rowOffset + 1);
    return this;
  }

  single() {
    this.singleMode = 'single';
    return this;
  }

  maybeSingle() {
    this.singleMode = 'maybe';
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    if (!this.execution) this.execution = this.execute();
    return this.execution.then(onfulfilled, onrejected);
  }

  private addFilter(column: string, operator: Filter['operator'], value: unknown) {
    identifier(column);
    this.filters.push({ column, operator, value });
    return this;
  }

  private buildWhere(parameters: unknown[], alias = 't') {
    const clauses: string[] = [];
    const columnSql = (column: string) => `${alias}.${identifier(column)}`;

    for (const filter of this.filters) {
      const column = columnSql(filter.column);
      if (filter.operator === 'in') {
        const values = Array.isArray(filter.value) ? filter.value : [];
        if (!values.length) {
          clauses.push('FALSE');
          continue;
        }
        const placeholders = values.map((value) => {
          parameters.push(value);
          return `$${parameters.length}`;
        });
        clauses.push(`${column} IN (${placeholders.join(', ')})`);
      } else if (filter.operator === 'is' || filter.operator === 'not_is') {
        if (filter.value !== null) {
          parameters.push(filter.value);
          clauses.push(
            `${column} ${filter.operator === 'is' ? 'IS NOT DISTINCT FROM' : 'IS DISTINCT FROM'} $${parameters.length}`,
          );
        } else {
          clauses.push(`${column} IS ${filter.operator === 'not_is' ? 'NOT ' : ''}NULL`);
        }
      } else {
        parameters.push(filter.value);
        const sqlOperator = {
          eq: '=',
          neq: '<>',
          lte: '<=',
          gte: '>=',
          lt: '<',
          gt: '>',
        }[filter.operator];
        clauses.push(`${column} ${sqlOperator} $${parameters.length}`);
      }
    }

    for (const orExpression of this.orFilters) {
      const alternatives: string[] = [];
      for (const part of orExpression.split(',')) {
        const match = part.match(/^([a-z_][a-z0-9_]*)\.(ilike|eq)\.(.*)$/i);
        if (!match) continue;
        identifier(match[1]);
        parameters.push(match[3]);
        alternatives.push(
          `${columnSql(match[1])} ${match[2].toLowerCase() === 'ilike' ? 'ILIKE' : '='} $${parameters.length}`,
        );
      }
      if (alternatives.length) clauses.push(`(${alternatives.join(' OR ')})`);
    }

    return clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  }

  private selectExpressions() {
    const parsed = parseSelection(this.selection);
    const expressions =
      parsed.scalarColumns[0] === '*'
        ? ['t.*']
        : parsed.scalarColumns.map((column) => `t.${identifier(column)}`);
    for (const relation of parsed.relations) {
      relation.columns.forEach(identifier);
      const relationPairs = relation.columns
        .map(
          (column) =>
            `'${column}', related.${identifier(column)}`,
        )
        .join(', ');
      expressions.push(`(
        SELECT json_build_object(${relationPairs})
        FROM public.${identifier(relation.table)} AS related
        WHERE related.id = t.${identifier(`${relation.alias}_id`)}
        LIMIT 1
      ) AS ${identifier(relation.alias)}`);
    }
    return expressions.join(', ');
  }

  private async executeSelect(): Promise<QueryResult> {
    const database = await getLocalAppDatabase();
    const parameters: unknown[] = [];
    const where = this.buildWhere(parameters);
    const order = this.orders.length
      ? ` ORDER BY ${this.orders
          .map(
            (item) =>
              `t.${identifier(item.column)} ${item.ascending ? 'ASC' : 'DESC'}${
                item.nullsFirst === undefined
                  ? ''
                  : item.nullsFirst
                    ? ' NULLS FIRST'
                    : ' NULLS LAST'
              }`,
          )
          .join(', ')}`
      : '';
    const limit = this.rowLimit === null ? '' : ` LIMIT ${this.rowLimit}`;
    const offset = this.rowOffset ? ` OFFSET ${this.rowOffset}` : '';
    let count: number | null = null;

    if (this.countMode) {
      const countResult = await database.query<{ count: number }>(
        `SELECT count(*)::bigint AS count FROM public.${identifier(this.tableName)} AS t${where}`,
        parameters,
      );
      count = Number(countResult.rows[0]?.count ?? 0);
    }
    if (this.head) {
      return { data: null, error: null, count, status: 200, statusText: 'OK' };
    }

    const result = await database.query<Row>(
      `SELECT ${this.selectExpressions()}
       FROM public.${identifier(this.tableName)} AS t${where}${order}${limit}${offset}`,
      parameters,
    );
    return this.finalizeRows(result.rows, count);
  }

  private async executeMutation(): Promise<QueryResult> {
    const database = await getLocalAppDatabase();
    const table = `public.${identifier(this.tableName)}`;
    let rows: Row[] = [];

    if (this.operation === 'insert' || this.operation === 'upsert') {
      const values = (Array.isArray(this.payload) ? this.payload : [this.payload]).filter(
        (value): value is Row => Boolean(value),
      );
      if (!values.length) {
        return { data: null, error: null, count: null, status: 201, statusText: 'Created' };
      }
      const columns = Object.keys(values[0]);
      columns.forEach(identifier);
      const parameters: unknown[] = [];
      const valueGroups = values.map((row) => {
        const placeholders = columns.map((column) => {
          parameters.push(row[column] ?? null);
          return `$${parameters.length}`;
        });
        return `(${placeholders.join(', ')})`;
      });
      let conflict = '';
      if (this.operation === 'upsert') {
        const updateColumns = columns.filter(
          (column) => !this.conflictColumns.includes(column),
        );
        conflict = ` ON CONFLICT (${this.conflictColumns
          .map(identifier)
          .join(', ')}) ${
          updateColumns.length
            ? `DO UPDATE SET ${updateColumns
                .map((column) => `${identifier(column)} = EXCLUDED.${identifier(column)}`)
                .join(', ')}`
            : 'DO NOTHING'
        }`;
      }
      const result = await database.query<Row>(
        `INSERT INTO ${table} (${columns.map(identifier).join(', ')})
         VALUES ${valueGroups.join(', ')}${conflict}
         RETURNING *`,
        parameters,
      );
      rows = result.rows;
    } else if (this.operation === 'update') {
      const payload = (this.payload ?? {}) as Row;
      const columns = Object.keys(payload);
      columns.forEach(identifier);
      if (!columns.length) throw new Error('No fields were provided for update.');
      const parameters: unknown[] = [];
      const assignments = columns.map((column) => {
        parameters.push(payload[column] ?? null);
        return `${identifier(column)} = $${parameters.length}`;
      });
      const where = this.buildWhere(parameters);
      const result = await database.query<Row>(
        `UPDATE ${table} AS t SET ${assignments.join(', ')}${where} RETURNING t.*`,
        parameters,
      );
      rows = result.rows;
    } else {
      const parameters: unknown[] = [];
      const where = this.buildWhere(parameters);
      const result = await database.query<Row>(
        `DELETE FROM ${table} AS t${where} RETURNING t.*`,
        parameters,
      );
      rows = result.rows;
    }

    if (!this.selectionRequested) {
      return {
        data: null,
        error: null,
        count: null,
        status: this.operation === 'insert' ? 201 : 200,
        statusText: 'OK',
      };
    }

    if (!rows.length) return this.finalizeRows([], null);
    const ids = rows.map((row) => row.id).filter(Boolean);
    if (ids.length === rows.length) {
      const selected = new LocalSupabaseQueryBuilder(this.tableName)
        .select(this.selection)
        .in('id', ids);
      const result = await selected.executeSelect();
      return this.finalizeRows((result.data ?? []) as Row[], null);
    }
    return this.finalizeRows(rows, null);
  }

  private finalizeRows(rows: Row[], count: number | null): QueryResult {
    if (this.singleMode) {
      if (rows.length === 1) {
        return { data: rows[0], error: null, count, status: 200, statusText: 'OK' };
      }
      if (this.singleMode === 'maybe' && rows.length === 0) {
        return { data: null, error: null, count, status: 200, statusText: 'OK' };
      }
      return {
        data: null,
        error: {
          message: `Expected one row but received ${rows.length}.`,
          code: 'PGRST116',
        },
        count,
        status: 406,
        statusText: 'Not Acceptable',
      };
    }
    return { data: rows, error: null, count, status: 200, statusText: 'OK' };
  }

  private async execute() {
    try {
      return this.operation === 'select'
        ? await this.executeSelect()
        : await this.executeMutation();
    } catch (error) {
      return errorResult(error);
    }
  }
}

export class LocalSupabaseClient {
  from(tableName: string) {
    return new LocalSupabaseQueryBuilder(tableName);
  }
}

let cachedLocalClient: LocalSupabaseClient | null = null;

export function getLocalSupabaseClient() {
  if (!cachedLocalClient) cachedLocalClient = new LocalSupabaseClient();
  return cachedLocalClient;
}
