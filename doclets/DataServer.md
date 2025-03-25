# Metric Data Server
Data Server provides a basic read, update, delete api for collections. It includes common syntax
for joins, filters, sorting and presentation. 

```http request
https://metric.im/data/{collection}
```

DataServer is designed to work with metric componenty. To configure options on the DataServer instance use
`new DataServer.Options({options})`. Available options are

* **safeDelete**, default=false, use trash collection to hold items that have been recently deleted
* **include**, default undefined, provides an array of collection names. If defined, /data will only work with these collections
* **exclude**, default ["user"], provides an array of collection names that cannot be referenced with /data
* **global**, default [], provides an array of collection names which are not specific to any account.

## GET /data
> *syntax*: `GET /data/[{format}/]{collection}/{id}[?{option}[&{option}]]`

| name       | description                                                                                                                                                         |
|------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| format     | Determines the format of the result. This includes: json, table, csv and chart. NOT YET IMPLEMENTED                                                                 |
| collection | Identifies the collection to query                                                                                                                                  |
| id         | Comma separated list of one or more id's within the collection. If not provided, all available records are returned                                                 |
| option     | Options to modify the results                                                                                                                                       |

### Options

| name  | description                                                                                   |
|-------|-----------------------------------------------------------------------------------------------|
| where | filter the results using the provided match clause. Follows mongo syntax without being strict |
| sort  | sort={fieldname} will sort ascendant. {fieldname}:-1, sorts descendant                        |

Both where and sort take mongo objects using <a href='https://github.com/jsonicjs/jsonic'>Jsonic</a> parsing.
Jsonic is JSON.parse(), but accepts super lax syntax. When in doubt, insert all the usual braces and quotes.

## PUT /data
> *syntax*: `PUT /data/{collection}`

| name       | description                              |
|------------|------------------------------------------|
| collection | Identifies the collection to insert into |

Expects a body object in the PUt/POST. If the _id field is included, the object is upserted, that is,
inserted or updated if a record with the same id exists. If no _id is provided a dated random alpha _id
is generated

## DELETE /data
> *syntax*: `DELETE /data/{collection}/{id}`

| name       | description                                                                   |
|------------|-------------------------------------------------------------------------------|
| collection | Identifies the collection to delete from                                      |
| id         | Comma separated list of one or more id's within the collection to be deleted. |

Items are moved to the trash collection if the DataServer is configured with safeDelete=true.

### Trash Handling

When safeDelete is set to true, an object is first saved in the trash collection before being removed
from the host collection. Records in the trash are structured in a container that identifies by who
and when the delete request was issued. The trashed item carries the id `{collection}::{_id}`.

Trash can be queried with GET `/data/trash`, and emptied deleted with DELETE `/data/trash/[{collection}]/[{id}]`.
Use id to delete the item permanently. If collection is provided without an ID, all trashed items from that
collection are permanently delete. If neither collection or id are provided, the trash is emptied entirely.
This requires super user privileges.

To restore a trashed item use POST `/data/trash/{trash_id}`. This will put the object back in the
collection as it was and remove it from trash.

## Access Control

DataServer is built to work with the common account structure of metric componentry. Most objects
will be considered part of an account. This is defined by the field _account. The session user must have
explicit access to the account to manipulate object attached to that account. Objects that are not specific
to any account can be identified as "global" in the global options when instantiated the DataServer class.

### ACL usage