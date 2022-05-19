import jsonic from 'jsonic';
import moment from 'moment';

export default class Parser {
    static objectify(str) {
        let obj = jsonic(str);
        return fixRegex(obj);

        function fixRegex(obj) {
            for (const a in obj) {
                if (typeof obj[a] === 'object') fixRegex(obj[a]);
                else if (typeof obj[a] === 'string') {
                    let x = obj[a].match(/^\/(.*)\/(.*)/);
                    if (x) obj[a] = {$regex:x[1],$options:x[2]}
                    else {
                        let y = obj[a].match(/ISODate\((.*)\)/)
                        if (y) obj[a] = new Date(y[1]);
                    }
                }
            }
            return obj;
        }
    }
    static sortify(str) {
        if (!str) return {_id:1};
        let sorter = {};
        str = decodeURIComponent(str);
        let p = str.replace(/[{}"']/g,"").split(",");
        for (let i=0;i<p.length;i++) {
            let nv=p[i].split(':');
            nv[1] = parseInt(nv[1]) || 1;
            sorter[nv[0]] = nv[1];
        }
        return sorter;
    };
    static parseQuery(url) {
        return url.replace(/(^\?)/,'').split("&").map(function(n){return n = n.split("="),this[n[0]] = n[1],this}.bind({}))[0];
    };
    static parseTimeFilter(options,dateField='timestamp') {
        let filter = {};
        if (options.days) {
            filter[dateField] = {$gte:moment().subtract(options.days,'days').toDate()}
        }
        return filter;
    }
    static time(time) {
        time = moment(time);
        return {
            year:parseInt(time.format('YYYY')),
            month:parseInt(time.format('M')),
            day:parseInt(time.format('D')),
            hour:parseInt(time.format('H')),
            minute:parseInt(time.format('m')),
            second:parseInt(time.format('s')),
            week:parseInt(time.format('w')),
            month_name:time.format('MMMM'),
            weekday:time.format('dddd'),
            _time:time.toDate(),
            date:time.format('YYYY-MM-DD')
        }
    }
}


