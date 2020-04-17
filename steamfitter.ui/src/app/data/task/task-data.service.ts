/*
Crucible
Copyright 2020 Carnegie Mellon University.
NO WARRANTY. THIS CARNEGIE MELLON UNIVERSITY AND SOFTWARE ENGINEERING INSTITUTE MATERIAL IS FURNISHED ON AN "AS-IS" BASIS. CARNEGIE MELLON UNIVERSITY MAKES NO WARRANTIES OF ANY KIND, EITHER EXPRESSED OR IMPLIED, AS TO ANY MATTER INCLUDING, BUT NOT LIMITED TO, WARRANTY OF FITNESS FOR PURPOSE OR MERCHANTABILITY, EXCLUSIVITY, OR RESULTS OBTAINED FROM USE OF THE MATERIAL. CARNEGIE MELLON UNIVERSITY DOES NOT MAKE ANY WARRANTY OF ANY KIND WITH RESPECT TO FREEDOM FROM PATENT, TRADEMARK, OR COPYRIGHT INFRINGEMENT.
Released under a MIT (SEI)-style license, please see license.txt or contact permission@sei.cmu.edu for full terms.
[DISTRIBUTION STATEMENT A] This material has been approved for public release and unlimited distribution.  Please see Copyright notice for non-US Government use and distribution.
Carnegie Mellon(R) and CERT(R) are registered in the U.S. Patent and Trademark Office by Carnegie Mellon University.
DM20-0181
*/

import {TaskStore} from './task.store';
import {TaskQuery} from './task.query';
import {TaskResultStore} from 'src/app/data/task-result/task-result.store';
import {TaskResultQuery} from 'src/app/data/task-result/task-result.query';
import {Injectable} from '@angular/core';
import {FormControl} from '@angular/forms';
import {PageEvent} from '@angular/material';
import {Router, ActivatedRoute} from '@angular/router';
import {Task} from 'src/app/data/task/task.store';
import {DispatchTaskService, DispatchTaskResultService} from 'src/app/swagger-codegen/dispatcher.api';
import {map, take, tap} from 'rxjs/operators';
import {BehaviorSubject, Observable, combineLatest} from 'rxjs';

export interface Clipboard {
  taskId: string;
  isCut: string;
}

export interface PasteLocation {
  id: string;
  locationType: string;
}

@Injectable({
  providedIn: 'root'
})

export class TaskDataService {
  private _requestedTaskId: string;
  private _requestedTaskId$ = this.activatedRoute.queryParamMap.pipe(
    map(params => params.get('taskId') || ''),
  );
  readonly taskList: Observable<Task[]>;
  readonly selected: Observable<Task>;
  readonly filterControl = new FormControl();
  private filterTerm: Observable<string>;
  private _pageEvent: PageEvent = {length: 0, pageIndex: 0, pageSize: 10};
  readonly pageEvent = new BehaviorSubject<PageEvent>(this._pageEvent);
  readonly clipboard = new BehaviorSubject<Clipboard>(null);
  private _clipboard = null;

  constructor(
    private taskStore: TaskStore,
    private taskQuery: TaskQuery,
    private taskService: DispatchTaskService,
    private taskResultStore: TaskResultStore,
    private taskResultQuery: TaskResultQuery,
    private taskResultService: DispatchTaskResultService,
    private router: Router,
    private activatedRoute: ActivatedRoute
  ) {
    this.filterTerm = activatedRoute.queryParamMap.pipe(
      map(params => params.get('taskmask') || '')
    );
    this.filterControl.valueChanges.subscribe(term => {
      this.router.navigate([], { queryParams: { taskmask: term }, queryParamsHandling: 'merge'});
    });
    this.taskList = combineLatest([this.taskQuery.selectAll(), this.filterTerm, this.pageEvent]).pipe(
      map(([items, filterTerm, page]) => {
        if (!items || items.length === 0) {
          if (page.length !== 0) {
            page.length = 0;
            page.pageIndex = 0;
          }
          return [];
        }

        let taskList = items ? items as Task[] : [];
        taskList = taskList.filter(item => item.name.toLowerCase().includes(filterTerm.toLowerCase()) ||
          item.id.toLowerCase().includes(filterTerm.toLowerCase()));
        const pgsz = page.pageSize;
        const startIndex = page.pageIndex * pgsz;
        taskList = taskList.splice(startIndex, pgsz);
        // if the taskList length has changed, then a new pageEvent is needed
        if (this._pageEvent.length !== taskList.length) {
          this._pageEvent = {
            length: taskList.length,
            pageIndex: 0,
            pageSize: this._pageEvent.pageSize
          };
          this.pageEvent.next(this._pageEvent);
        }
        return taskList;
      })
    );
    this.selected = combineLatest([this.taskList, this._requestedTaskId$]).pipe(
      map(([taskList, requestedTaskId]) => {
        let selectedTask: Task = null;
        if (taskList && taskList.length > 0 && requestedTaskId) {
          selectedTask = taskList.find(task => task.id === requestedTaskId);
          if (selectedTask && selectedTask.id !== this._requestedTaskId) {
            this.taskStore.setActive(selectedTask.id);
            this._requestedTaskId = requestedTaskId;
          }
        } else {
          this._requestedTaskId = '';
          this.taskStore.setActive('');
          this.taskStore.update({taskList: []});
        }
        return selectedTask;
      })
    );
  }

  load() {
    this.taskStore.setLoading(true);
    this.taskService.getDispatchTasks().pipe(
      tap(() => { this.taskStore.setLoading(false); }),
      take(1)
    ).subscribe(tasks => {
      this.taskStore.set(tasks);
    }, error => {
      this.taskStore.set([]);
    });
  }

  loadByScenarioTemplate(scenarioTemplateId: string) {
    this.taskStore.set([]);
    return this.taskService.getScenarioDispatchTasks(scenarioTemplateId).pipe(take(1)).subscribe(tasks => {
      this.taskStore.set(tasks);
    });
  }

  loadByScenario(scenarioId: string) {
    this.taskStore.set([]);
    this.taskResultStore.set([]);
    this.taskService.getSessionDispatchTasks(scenarioId).pipe(take(1)).subscribe(tasks => {
      this.taskStore.set(tasks);
      }
    );
    this.taskResultService.getSessionDispatchTaskResults(scenarioId).pipe(take(1)).subscribe(taskResults => {
      this.taskResultStore.set(taskResults);
    });
  }

  loadById(id: string): Observable<Task> {
    this.taskStore.setLoading(true);
    return this.taskService.getDispatchTask(id).pipe(
      tap((_task: Task) => {
        this.taskStore.upsert(_task.id, {..._task});
      }),
      tap(() => { this.taskStore.setLoading(false); })
    );
  }

  add(task: Task) {
    this.taskStore.setLoading(true);
    this.taskService.createDispatchTask(task).pipe(
        tap(() => { this.taskStore.setLoading(false); }),
        take(1)
      ).subscribe(dt => {
        this.taskStore.add(dt);
        this.setActive(dt.id);
      }
    );
  }

  updateTask(task: Task) {
    this.taskStore.setLoading(true);
    this.taskService.updateDispatchTask(task.id, task).pipe(
        tap(() => { this.taskStore.setLoading(false); }),
        take(1)
      ).subscribe(dt => {
        this.taskStore.upsert(dt.id, dt);
      }
    );
  }

  execute(id: string) {
    this.taskService.executeDispatchTask(id).pipe(take(1)).subscribe(results => {
      results.forEach(dtr => {
        this.taskResultStore.upsert(dtr.id, dtr);
      });
    });
  }

  delete(id: string) {
    this.taskService.deleteDispatchTask(id).pipe(take(1)).subscribe(dt => {
      this.taskStore.remove(id);
    });
  }

  setActive(id: string) {
    this.router.navigate([], { queryParams: { taskId: id }, queryParamsHandling: 'merge'});
  }

  setPageEvent(pageEvent: PageEvent) {
    this.taskStore.update({pageEvent: pageEvent});
  }

  setClipboard(data: Clipboard) {
    this._clipboard = data;
    this.clipboard.next(data);
  }

  pasteClipboard(location: PasteLocation) {
    if (!!this._clipboard) {
      if (this._clipboard.isCut) {
        this.taskService.moveDispatchTask(this._clipboard.id, location).pipe(take(1)).subscribe(dts => {
            dts.forEach(dt => {
              this.taskStore.upsert(dt.id, dt);
              if (!!dt.triggerTaskId) {
                this.setActive(dt.id);
              }
            });
          }
        );
      } else {
        this.taskService.copyDispatchTask(this._clipboard.id, location).pipe(take(1)).subscribe(dts => {
          dts.forEach(dt => {
            this.taskStore.add(dt);
            if (!!dt.triggerTaskId) {
              this.setActive(dt.id);
            }
          });
        }
      );
      }
    }
    this.setClipboard(null);
  }

}

